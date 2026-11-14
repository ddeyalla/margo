"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowLeft, ChevronLeft, ChevronRight, CircleAlert, FileWarning, Moon, PanelRight, Sun, TableOfContents, X } from "lucide-react";
import { createResizableController, Resizable, ResizableHandle, ResizablePanel } from "@ui-sdk/react/resizable";
import { HighlightMenu } from "@/components/annotations/HighlightMenu";
import type { NoteDraft } from "@/components/annotations/NotesTab";
import { useAnnotations } from "@/components/annotations/useAnnotations";
import { ReviewSheet } from "@/components/cards/ReviewSheet";
import { useCards } from "@/components/cards/useCards";
import { ProviderPicker } from "@/components/chat/ProviderPicker";
import { useProviders } from "@/components/chat/useProviders";
import { useTutor, type MessageDraft } from "@/components/chat/useTutor";
import { EpubReader } from "@/components/reader/EpubReader";
import { PdfReader } from "@/components/reader/PdfReader";
import { SelectionToolbar, type SelectionToolbarHandle } from "@/components/reader/SelectionToolbar";
import type { OpenFailure } from "@/components/reader/errors";
import type { ReaderHandle, ReaderMeta, ReaderPlace, ReaderProps, SelectionRect, TocEntry } from "@/components/reader/types";
import { EmptyState, IconButton, Segmented } from "@/components/ui";
import { patchBookState, patchSettings } from "@/lib/client/api";
import { isTextEntry } from "@/lib/client/keys";
import { anchorAt } from "@/lib/shared/place";
import type { Anchor, BookFormat, BookId, BookState, PanelTab, Position, ProviderId, ReadingFont, ReadingMode, ReadingTheme, SelectionContext, TutorAction } from "@/lib/shared/types";
import { ReadingFooter } from "./ReadingFooter";
import { ReadingSettings } from "./ReadingSettings";
import { SidePanel } from "./SidePanel";
import { TocDrawer } from "./TocDrawer";
import { usePositionSaver } from "./usePositionSaver";
import { useRefreshOnReturn } from "./useRefreshOnReturn";

export interface WorkspaceBook {
  id: BookId;
  format: BookFormat;
  relPath: string;
  fileTitle: string;
}

const PANEL_ID = "tutor-panel";
const TOC_SHORTCUT = "⌘⇧L";
/** The chapters column's width. */
const TOC_WIDTH = 280;
/** The narrowest the book may get beside the chapters column; below this the chapters slide over the book instead. */
const READER_MIN_WIDTH = 480;

const MODES: { value: ReadingMode; label: string }[] = [
  { value: "scroll", label: "Scroll" },
  { value: "pages", label: "Pages" },
];

/* A PDF keeps its own page colours; "dark" here is the switch that darkens white pages. */
const PDF_THEMES: { value: ReadingTheme; label: string; icon: ReactNode }[] = [
  { value: "dark", label: "Show white pages dark", icon: <Moon /> },
  { value: "light", label: "Show pages in their own colours", icon: <Sun /> },
];

/** Keys that turn the page in Pages mode. */
const PAGE_KEYS: Record<string, 1 | -1> = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 };

/** Lists, toolbars, the progress bar and the side panel use the arrow keys themselves, so those keys don't turn pages there. */
const usesArrows = (target: EventTarget | null) =>
  target instanceof Element && !!target.closest(`nav, [role="toolbar"], [role="tablist"], [role="menu"], [role="slider"], #${PANEL_ID}`);

export function BookWorkspace({
  book,
  initialState,
  savedProvider,
  savedDarkPages,
  savedReadingMode,
  savedEpubTheme,
  savedBoldStarts,
  savedReadingFont,
  savedChaptersOpen,
  savedPanelTab,
}: {
  book: WorkspaceBook;
  initialState: BookState;
  savedProvider: ProviderId | null;
  savedDarkPages: boolean;
  savedReadingMode: ReadingMode;
  savedEpubTheme: ReadingTheme;
  savedBoldStarts: boolean;
  savedReadingFont: ReadingFont;
  savedChaptersOpen: boolean;
  savedPanelTab: PanelTab;
}) {
  const readerRef = useRef<ReaderHandle>(null);
  const toolbarRef = useRef<SelectionToolbarHandle>(null);
  const readerAreaRef = useRef<HTMLElement>(null);
  const readerPaneRef = useRef<HTMLDivElement>(null);
  const [layout] = useState(createResizableController);
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState(savedPanelTab);
  const [meta, setMeta] = useState({
    title: initialState.meta?.title ?? null,
    author: initialState.meta?.author ?? null,
  });
  /* The table of contents, null until the reader has opened the book. */
  const [toc, setToc] = useState<TocEntry[] | null>(null);
  const [tocOpen, setTocOpen] = useState(savedChaptersOpen);
  /* Opening or closing the column by hand is remembered; a sliding column closing itself after a pick is not. */
  const chooseToc = useCallback((open: boolean) => {
    setTocOpen(open);
    void patchSettings({ chaptersOpen: open });
  }, []);
  const closeToc = useCallback(() => chooseToc(false), [chooseToc]);
  /* Whether the reader pane has room for the chapters as a column beside the book. */
  const [tocDocked, setTocDocked] = useState(true);
  /* How far into the book the reader is, and the chapter and page that is. */
  const [position, setPosition] = useState<Position | null>(null);
  const [place, setPlace] = useState<ReaderPlace | null>(null);
  const chapter = place?.chapter ?? null;
  const [mode, setMode] = useState(savedReadingMode);
  const [error, setError] = useState<OpenFailure | null>(null);
  const [darkPages, setDarkPages] = useState(savedDarkPages);
  const [epubTheme, setEpubTheme] = useState(savedEpubTheme);
  const [boldStarts, setBoldStarts] = useState(savedBoldStarts);
  const [readingFont, setReadingFont] = useState(savedReadingFont);
  /* A font shown on the page while the reader looks through the list, before choosing one. */
  const [previewFont, setPreviewFont] = useState<ReadingFont | undefined>(undefined);
  const title = meta.title || book.fileTitle;
  const { save: savePosition, flush: flushPosition } = usePositionSaver(book.id);
  const readRevision = useCallback(async () => {
    const response = await fetch(`/api/books/${book.id}/revision`, { cache: "no-store" });
    return response.ok ? ((await response.json()) as { revision: string }).revision : null;
  }, [book.id]);
  const tutor = useTutor(book.id, initialState.threads, initialState.activeThreadId);
  const { providers, current: provider, choose: chooseProvider, unavailable } = useProviders(savedProvider);
  const annotations = useAnnotations(book.id, { highlights: initialState.highlights, notes: initialState.notes }, readerRef);
  const cards = useCards(book.id, initialState.cardSets);
  const [reviewing, setReviewing] = useState(false);
  /* The highlight the reader clicked, with the menu that offers its note and removal. */
  const [menu, setMenu] = useState<{ id: string; rect: SelectionRect } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
  /* The same book open in another window: show its changes when this one comes back, unless this one is mid-answer or mid-note. */
  useRefreshOnReturn(readRevision, flushPosition, () => tutor.sending || cards.jobs.length > 0 || noteDraft !== null);
  const [noteFocus, setNoteFocus] = useState<{ id: string; at: number } | null>(null);

  /* A layout restored from an earlier visit may start with the panel collapsed; read it once the group has attached. */
  useEffect(() => {
    const frame = requestAnimationFrame(() => setPanelOpen(!layout.isCollapsed(PANEL_ID)));
    return () => cancelAnimationFrame(frame);
  }, [layout]);

  /* The pane's width holds still while the chapters column opens, since the column lives inside it. */
  useEffect(() => {
    const pane = readerPaneRef.current;
    if (!pane) return;
    const observer = new ResizeObserver(([entry]) => setTocDocked(entry.contentRect.width - TOC_WIDTH >= READER_MIN_WIDTH));
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);

  /* The book's own title and author replace the file name once it has been opened. */
  const handleReady = (next: ReaderMeta) => {
    setToc(next.toc);
    const merged = { title: next.title ?? meta.title, author: next.author ?? meta.author };
    setMeta(merged);
    const stored = initialState.meta;
    const title = merged.title ?? book.fileTitle;
    if (stored?.title !== title || stored?.author !== merged.author) {
      void patchBookState(book.id, { meta: { title, author: merged.author } });
    }
  };

  /* Selection rects arrive on every scroll frame; they go straight to the toolbar, never through state here. */
  const handleSelection = useCallback((rect: SelectionRect | null) => {
    toolbarRef.current?.update(rect);
    if (rect) setMenu(null);
  }, []);
  const readerBounds = useCallback(() => readerAreaRef.current?.getBoundingClientRect() ?? null, []);
  const readSelection = useCallback(() => readerRef.current?.getSelection() ?? null, []);

  const togglePanel = () => (layout.isCollapsed(PANEL_ID) ? layout.expand(PANEL_ID) : layout.collapse(PANEL_ID));

  const chooseDarkPages = (dark: boolean) => {
    setDarkPages(dark);
    void patchSettings({ pdfDarkPages: dark });
  };

  const chooseEpubTheme = (theme: ReadingTheme) => {
    setEpubTheme(theme);
    void patchSettings({ epubTheme: theme });
  };

  const chooseBoldStarts = (on: boolean) => {
    setBoldStarts(on);
    void patchSettings({ boldStarts: on });
  };

  const chooseFont = (font: ReadingFont) => {
    setPreviewFont(undefined);
    setReadingFont(font);
    void patchSettings({ readingFont: font });
  };

  const chooseMode = (next: ReadingMode) => {
    if (next === mode) return;
    setMode(next);
    void patchSettings({ readingMode: next });
  };

  const chooseTab = (next: PanelTab) => {
    if (next === tab) return;
    setTab(next);
    void patchSettings({ panelTab: next });
  };

  const showTab = (next: PanelTab) => {
    chooseTab(next);
    if (layout.isCollapsed(PANEL_ID)) layout.expand(PANEL_ID);
  };

  const startThread = (action: TutorAction, selection: SelectionContext, question: string | null) => {
    if (!provider) return;
    readerRef.current?.clearSelection();
    showTab("chat");
    tutor.start(action, selection, question, provider);
  };

  /* A question with no passage remembers where the reader was, so its thread can lead back there. */
  const askAnywhere = (draft: MessageDraft) => {
    if (!provider) return;
    tutor.ask(draft, position && { anchor: anchorAt(position), chapterTitle: chapter?.label ?? null }, provider);
  };

  const highlight = (selection: SelectionContext) => {
    readerRef.current?.clearSelection();
    annotations.highlight(selection);
  };

  const writeNote = (selection: SelectionContext) => {
    readerRef.current?.clearSelection();
    setNoteDraft({ kind: "new", selection });
    showTab("notes");
  };

  const makeCards = (selection: SelectionContext) => {
    if (!provider) return;
    readerRef.current?.clearSelection();
    showTab("cards");
    void cards.make(selection, provider);
  };

  const openNote = (noteId: string) => {
    showTab("notes");
    setNoteFocus({ id: noteId, at: Date.now() });
  };

  /* The docked column stays open; the sliding one gets out of the way. */
  const openEntry = (entry: TocEntry) => {
    if (!tocDocked) setTocOpen(false);
    void readerRef.current?.goToEntry(entry);
  };

  /* Keys from the EPUB's frame are forwarded here too. */
  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey;
    /* The review sheet has its own keys: Space, 1 to 4 and Esc. */
    if (reviewing && !mod) return;
    if (mod && !event.shiftKey && !event.altKey && event.code === "Backslash") {
      event.preventDefault();
      togglePanel();
    } else if (mod && event.shiftKey && !event.altKey && event.code === "KeyL") {
      event.preventDefault();
      if (!error) chooseToc(!tocOpen);
    } else if (mod && event.shiftKey && !event.altKey && event.code === "KeyH" && !isTextEntry(event.target)) {
      event.preventDefault();
      const selection = readerRef.current?.getSelection();
      if (selection) highlight(selection);
    } else if (event.key === "Escape" && !isTextEntry(event.target)) {
      readerRef.current?.clearSelection();
    } else if (
      mode === "pages" &&
      event.key in PAGE_KEYS &&
      !mod &&
      !event.shiftKey &&
      !event.altKey &&
      !isTextEntry(event.target) &&
      !usesArrows(event.target)
    ) {
      event.preventDefault();
      readerRef.current?.turnPage(PAGE_KEYS[event.key]);
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onShortcut(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const menuNote = menu ? annotations.notes.find((note) => note.highlightId === menu.id) : undefined;

  const jumpTo = (anchor: Anchor) => void readerRef.current?.goTo(anchor);

  const readerProps: ReaderProps = {
    ref: readerRef,
    bookId: book.id,
    initialPosition: initialState.position,
    onReady: handleReady,
    onSelectionChange: handleSelection,
    mode,
    onPositionChange: (next, nextPlace) => {
      setPlace(nextPlace);
      setPosition(next);
      savePosition(next);
      setMenu(null);
    },
    onError: setError,
    onHighlightClick: (id, rect) => setMenu({ id, rect }),
  };

  return (
    <div className="flex h-dvh flex-col bg-ink">
      <title>{`${title} · rigg learn`}</title>
      <header className="flex h-11 shrink-0 items-center gap-1.5 bg-shell px-2">
        <Link
          href="/"
          aria-label="Back to library"
          title="Back to library"
          className="press flex size-7 shrink-0 items-center justify-center rounded-sm text-dim transition-colors duration-[var(--duration-fast)] hover:bg-white/[0.06] hover:text-paper"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <IconButton
          label={tocOpen ? `Hide chapters (${TOC_SHORTCUT})` : `Show chapters (${TOC_SHORTCUT})`}
          active={tocOpen}
          disabled={!!error}
          onClick={() => chooseToc(!tocOpen)}
          data-toc-toggle
        >
          <TableOfContents />
        </IconButton>
        <div className="ml-1 flex min-w-0 flex-1 items-baseline gap-2">
          <h1 className="truncate text-[13px] font-medium text-paper">{title}</h1>
          {chapter ? <span className="truncate text-label text-dim">{chapter.label}</span> : null}
        </div>
        <div className="shrink-0">
          <ProviderPicker providers={providers} current={provider} onSelect={chooseProvider} />
        </div>
        <Segmented label="Reading mode" options={MODES} value={mode} onChange={chooseMode} />
        {book.format === "epub" ? (
          <ReadingSettings
            theme={epubTheme}
            onTheme={chooseEpubTheme}
            boldStarts={boldStarts}
            onBoldStarts={chooseBoldStarts}
            font={readingFont}
            onPreviewFont={setPreviewFont}
            onFont={chooseFont}
          />
        ) : (
          <Segmented label="Page colours" options={PDF_THEMES} value={darkPages ? "dark" : "light"} onChange={(theme) => chooseDarkPages(theme === "dark")} />
        )}
        <IconButton
          label={panelOpen ? "Hide the tutor panel (⌘\\)" : "Show the tutor panel (⌘\\)"}
          active={panelOpen}
          aria-controls={PANEL_ID}
          onClick={togglePanel}
        >
          <PanelRight />
        </IconButton>
      </header>
      <Resizable
        controller={layout}
        autoSaveId="rigg-learn.book-layout"
        onLayoutChange={() => setPanelOpen(!layout.isCollapsed(PANEL_ID))}
        className="min-h-0 flex-1"
      >
        <ResizablePanel id="reader-panel" minSize="360px" className="min-w-0">
          <div ref={readerPaneRef} style={{ "--toc-width": `${TOC_WIDTH}px` } as CSSProperties} className="flex h-full min-w-0">
            {tocDocked && !error ? (
              <div
                inert={!tocOpen}
                className="h-full shrink-0 overflow-hidden transition-[width] duration-[var(--duration-base)] ease-out"
                style={{ width: tocOpen ? TOC_WIDTH : 0 }}
              >
                <TocDrawer toc={toc} current={chapter} format={book.format} shortcut={TOC_SHORTCUT} open={tocOpen} docked onSelect={openEntry} onClose={closeToc} />
              </div>
            ) : null}
            <main
              ref={readerAreaRef}
              data-dark-pages={(book.format === "pdf" && darkPages) || undefined}
              data-reading-theme={book.format === "epub" ? epubTheme : undefined}
              className="relative flex h-full min-w-0 flex-1 flex-col"
            >
              {annotations.error ? (
                <div
                  role="alert"
                  className="animate-rise absolute left-1/2 top-3 z-20 flex w-max max-w-[min(520px,calc(100%-24px))] -translate-x-1/2 items-start gap-2 rounded-lg bg-panel-raised py-2 pl-3 pr-1.5 text-label text-fog shadow-float ring-1 ring-white/[0.06]"
                >
                  <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warn" />
                  <p className="min-w-0 py-px leading-relaxed [overflow-wrap:anywhere]">{annotations.error}</p>
                  <IconButton label="Dismiss" size="sm" onClick={annotations.dismissError}>
                    <X />
                  </IconButton>
                </div>
              ) : null}
              {error ? (
                <EmptyState icon={<FileWarning />} title="This book could not be opened" body={error.message}>
                  {error.detail ? <p className="mt-2 max-w-[48ch] font-mono text-[11px] leading-relaxed text-dim/80 [overflow-wrap:anywhere]">{error.detail}</p> : null}
                  <Link href="/" className="press mt-3 rounded-sm bg-panel-raised px-2.5 py-1.5 text-label font-medium text-fog transition-colors duration-[var(--duration-fast)] hover:bg-panel-hover hover:text-paper">
                    Back to library
                  </Link>
                </EmptyState>
              ) : (
                <>
                  <div className="relative min-h-0 flex-1">
                    {book.format === "epub" ? <EpubReader {...readerProps} theme={epubTheme} boldStarts={boldStarts} font={previewFont === undefined ? readingFont : previewFont} /> : <PdfReader {...readerProps} />}
                    {mode === "pages" ? (
                      <>
                        <PageTurn direction={-1} onTurn={(direction) => readerRef.current?.turnPage(direction)} />
                        <PageTurn direction={1} onTurn={(direction) => readerRef.current?.turnPage(direction)} />
                      </>
                    ) : null}
                  </div>
                  <ReadingFooter fraction={position?.fraction ?? 0} place={place} onSeek={(fraction) => readerRef.current?.seek(fraction)} />
                </>
              )}
              {reviewing ? <ReviewSheet cards={cards} onClose={() => setReviewing(false)} onJump={jumpTo} /> : null}
              {!tocDocked && !error ? (
                <TocDrawer toc={toc} current={chapter} format={book.format} shortcut={TOC_SHORTCUT} open={tocOpen} docked={false} onSelect={openEntry} onClose={closeToc} />
              ) : null}
            </main>
          </div>
        </ResizablePanel>
        <ResizableHandle
          aria-label="Resize the tutor panel"
          className="relative z-10 w-px shrink-0 bg-line outline-none transition-colors duration-[var(--duration-fast)] before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-[''] focus-visible:bg-fog data-[dragging]:bg-line-strong data-[hovering]:bg-line-strong"
        />
        <ResizablePanel
          id={PANEL_ID}
          defaultSize="380px"
          minSize="300px"
          maxSize="50%"
          collapsible
          className="min-w-0 overflow-hidden"
        >
          <SidePanel
            tab={tab}
            onTabChange={chooseTab}
            tutor={tutor}
            unavailable={unavailable}
            onJump={jumpTo}
            onAsk={askAnywhere}
            onReply={(draft) => provider && tutor.reply(draft, provider)}
            onRetry={() => provider && tutor.retry(provider)}
            annotations={annotations}
            noteDraft={noteDraft}
            noteFocus={noteFocus}
            onNoteDraft={setNoteDraft}
            onOpenNote={openNote}
            cards={cards}
            onReview={() => setReviewing(true)}
          />
        </ResizablePanel>
      </Resizable>
      <SelectionToolbar
        ref={toolbarRef}
        bounds={readerBounds}
        readSelection={readSelection}
        disabledReason={unavailable}
        onAction={(action, selection) => startThread(action, selection, null)}
        onAsk={(text, selection, kind) => startThread(kind, selection, text)}
        onHighlight={highlight}
        onNote={writeNote}
        onCard={makeCards}
        onDismiss={() => readerRef.current?.clearSelection()}
      />
      {menu ? (
        <HighlightMenu
          key={menu.id}
          rect={menu.rect}
          bounds={readerBounds}
          hasNote={!!menuNote}
          onNote={() => {
            if (menuNote) openNote(menuNote.id);
            setMenu(null);
          }}
          onRemove={() => {
            annotations.removeHighlight(menu.id);
            setMenu(null);
          }}
          onClose={closeMenu}
        />
      ) : null}
    </div>
  );
}

/** A quiet strip along the reader's left or right edge that turns the page in Pages mode. */
function PageTurn({ direction, onTurn }: { direction: 1 | -1; onTurn(direction: 1 | -1): void }) {
  const Icon = direction === 1 ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      aria-label={direction === 1 ? "Next page" : "Previous page"}
      title={direction === 1 ? "Next page (→)" : "Previous page (←)"}
      onClick={() => onTurn(direction)}
      className={clsx(
        "group absolute inset-y-0 z-20 flex w-10 items-center justify-center text-page-dim/70 outline-none transition-colors duration-[var(--duration-fast)] hover:bg-prose/[0.03] hover:text-prose focus-visible:text-prose",
        direction === 1 ? "right-0" : "left-0",
      )}
    >
      <Icon className="size-5 transition-transform duration-[var(--duration-fast)] group-active:scale-90" />
    </button>
  );
}
