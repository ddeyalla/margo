"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, CircleAlert, Focus, FileWarning, Moon, PanelRight, Sun, SunMoon, TableOfContents, X } from "lucide-react";
import { createResizableController, Resizable, ResizableHandle, ResizablePanel } from "@ui-sdk/react/resizable";
import { HighlightMenu } from "@/components/annotations/HighlightMenu";
import type { NoteDraft } from "@/components/annotations/NotesTab";
import { useAnnotations } from "@/components/annotations/useAnnotations";
import { ReviewSheet } from "@/components/cards/ReviewSheet";
import { useCards } from "@/components/cards/useCards";
import { ProviderPicker } from "@/components/chat/ProviderPicker";
import { dictationBusy } from "@/components/chat/useDictation";
import { useProviders } from "@/components/chat/useProviders";
import { useTutor, type MessageDraft } from "@/components/chat/useTutor";
import { EpubReader } from "@/components/reader/EpubReader";
import { PdfReader } from "@/components/reader/PdfReader";
import { SelectionToolbar, type SelectionToolbarHandle } from "@/components/reader/SelectionToolbar";
import type { OpenFailure } from "@/components/reader/errors";
import type { ReaderHandle, ReaderMeta, ReaderPlace, ReaderProps, SelectionRect, TocEntry } from "@/components/reader/types";
import { EmptyState, IconButton, Segmented } from "@/components/ui";
import { useResolvedTheme } from "@/components/ui/theme";
import { patchBookState, patchSettings } from "@/lib/client/api";
import { isTextEntry } from "@/lib/client/keys";
import { consumeRefreshMark } from "@/lib/client/open";
import { hasUnsentText } from "@/lib/client/unsent";
import { anchorAt } from "@/lib/shared/place";
import { recentMarks, shouldShowResume } from "@/lib/shared/resume";
import { reviewQueue } from "@/lib/shared/schedule";
import type { Anchor, BookFormat, BookId, BookState, PanelTab, Position, ProviderId, ReadingFont, ReadingMode, ReadingTheme, SelectionContext, TutorAction } from "@/lib/shared/types";
import { OpeningNotice, type OpeningNotice as OpeningNoticeData } from "./OpeningNotice";
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
const SPOTLIGHT_SHORTCUT = "⌘⇧F";
/** How long the place must hold still before the greeting says where the reader left off. */
const SETTLE_MS = 700;
/** How long the small confirmation after parking a question stays. */
const TOAST_MS = 4000;
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
  { value: "auto", label: "Show white pages dark when the app is dark", icon: <SunMoon /> },
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
  savedPdfTheme,
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
  savedPdfTheme: ReadingTheme;
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
  const [pdfTheme, setPdfTheme] = useState(savedPdfTheme);
  const [epubTheme, setEpubTheme] = useState(savedEpubTheme);
  const appTheme = useResolvedTheme();
  const pageTheme = (theme: ReadingTheme) => (theme === "auto" ? appTheme : theme);
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
  /* The same book open in another window: show its changes when this one comes back, unless this one is mid-answer, mid-note, mid-dictation or holding words typed but not sent. */
  useRefreshOnReturn(readRevision, flushPosition, () => tutor.sending || cards.jobs.length > 0 || noteDraft !== null || dictationBusy() || hasUnsentText());
  const [noteFocus, setNoteFocus] = useState<{ id: string; at: number } | null>(null);

  /* What greets the reader on a fresh open: where they left off, and the cards that are due. */
  const [notice, setNotice] = useState<OpeningNoticeData | null>(null);
  /* Decided once, on the first page of this open; null means there is nothing to show. */
  const greeting = useRef<{ resume: boolean; due: number } | null>(null);
  const dismissNotice = useCallback(() => {
    greeting.current = null;
    setNotice(null);
  }, []);
  /* The book reports a place or two while it settles; the greeting waits for the place to hold still. */
  const settleTimer = useRef(0);
  const [settled, setSettled] = useState(false);
  const greeted = useRef(false);
  useEffect(() => {
    if (greeted.current) return;
    greeted.current = true;
    /* A page rebuilt after another window changed the book is not an open. */
    if (consumeRefreshMark()) return;
    const resume = shouldShowResume(initialState.position !== null, initialState.lastReadAt, new Date());
    const due = reviewQueue(initialState.cardSets, new Date()).length;
    if (resume || due > 0) greeting.current = { resume, due };
  }, [initialState]);

  /* Once the place has held still, the greeting is made from it: where the reader left off is where the book now is. */
  useEffect(() => {
    const hello = greeting.current;
    if (!settled || !hello || !position) return;
    greeting.current = null;
    const glimpse = hello.resume ? readerRef.current?.peek(position) ?? null : null;
    const label = chapter?.label ?? null;
    setNotice({
      resume: hello.resume
        ? { glimpse: glimpse?.text ?? null, before: glimpse?.before ?? null, chapter: label, fraction: position.fraction, marks: recentMarks(annotations.highlights, annotations.notes, label) }
        : null,
      due: hello.due,
    });
  }, [settled, position, chapter, annotations.highlights, annotations.notes]);
  useEffect(() => () => clearTimeout(settleTimer.current), []);

  /* The spotlight dims all but one paragraph and clears the chrome away. */
  const [spotlight, setSpotlight] = useState(false);
  const panelWasOpen = useRef(false);

  /* A small confirmation, such as after parking a question. */
  const [toast, setToast] = useState<{ text: string; action: boolean } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

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

  const choosePdfTheme = (theme: ReadingTheme) => {
    setPdfTheme(theme);
    void patchSettings({ pdfPage: theme });
  };

  const chooseEpubTheme = (theme: ReadingTheme) => {
    setEpubTheme(theme);
    void patchSettings({ epubPage: theme });
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
    if (!provider || tutor.sending) return;
    readerRef.current?.clearSelection();
    showTab("chat");
    tutor.start(action, selection, question, provider);
  };

  /* A question with no passage remembers where the reader was, so its thread can lead back there. */
  const askAnywhere = (draft: MessageDraft) => {
    if (!provider) return;
    tutor.ask(draft, position && { anchor: anchorAt(position), chapterTitle: chapter?.label ?? null }, provider);
  };

  const endSpotlight = () => {
    setSpotlight(false);
    if (panelWasOpen.current && layout.isCollapsed(PANEL_ID)) layout.expand(PANEL_ID);
  };

  const toggleSpotlight = () => {
    if (spotlight) return endSpotlight();
    if (book.format !== "epub" || error) return;
    panelWasOpen.current = !layout.isCollapsed(PANEL_ID);
    if (panelWasOpen.current) layout.collapse(PANEL_ID);
    dismissNotice();
    setSpotlight(true);
  };

  /* Saves the question on the passage and says so. The panel stays as it is and the tutor is not called. */
  const park = async (selection: SelectionContext, question: string) => {
    readerRef.current?.clearSelection();
    const saved = await tutor.park(selection, question, provider);
    setToast({ text: saved ? "Parked. It waits in the Chat tab." : "Couldn't park that question. Try again.", action: saved });
  };

  const sendParked = (id: string) => {
    if (!provider || tutor.sending) return;
    showTab("chat");
    tutor.unpark(id, provider);
  };

  /* Asks for a recap of what came before the reader's place. Given the text just before it, or, with none, only the place. */
  const recap = () => {
    const resume = notice?.resume;
    if (!provider || !resume || tutor.sending) return;
    dismissNotice();
    showTab("chat");
    if (position && resume.glimpse && resume.before !== null) {
      readerRef.current?.clearSelection();
      const selection: SelectionContext = {
        text: resume.glimpse,
        before: resume.before,
        after: "",
        anchor: anchorAt(position),
        chapterTitle: chapter?.label ?? null,
        rect: { top: 0, left: 0, width: 0, height: 0 },
      };
      tutor.start("recap", selection, null, provider);
    } else {
      askAnywhere({ text: "Give me a short recap of what came before my place in this chapter. Say nothing about what comes after it.", attachments: [] });
    }
  };

  /* The greeting is hidden while reviewing, so it goes for good once a review starts. */
  const startReview = () => {
    dismissNotice();
    setReviewing(true);
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
    dismissNotice();
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
    } else if (mod && event.shiftKey && !event.altKey && event.code === "KeyF" && !isTextEntry(event.target)) {
      event.preventDefault();
      toggleSpotlight();
    } else if (event.key === "Escape" && !isTextEntry(event.target)) {
      /* Esc takes one thing away at a time: the selection, then the greeting, then the spotlight. */
      const selected = !!readerRef.current?.getSelection();
      readerRef.current?.clearSelection();
      if (!selected) {
        if (notice) dismissNotice();
        else if (spotlight) toggleSpotlight();
      }
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
      dismissNotice();
      readerRef.current?.turnPage(PAGE_KEYS[event.key]);
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onShortcut(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const menuNote = menu ? annotations.notes.find((note) => note.highlightId === menu.id) : undefined;

  const turn = (direction: 1 | -1) => {
    dismissNotice();
    readerRef.current?.turnPage(direction);
  };

  const jumpTo = (anchor: Anchor) => {
    dismissNotice();
    void readerRef.current?.goTo(anchor);
  };

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
      if (greeting.current) {
        clearTimeout(settleTimer.current);
        settleTimer.current = window.setTimeout(() => setSettled(true), SETTLE_MS);
      }
    },
    onInteract: dismissNotice,
    onError: (failure) => {
      setError(failure);
      /* A book that failed to open has no page to spotlight, and the header must come back. */
      if (failure && spotlight) endSpotlight();
    },
    onHighlightClick: (id, rect) => setMenu({ id, rect }),
  };

  return (
    <div className="flex h-dvh flex-col bg-ink">
      <title>{`${title} · rigg learn`}</title>
      <header className={clsx("h-12 shrink-0 items-center gap-1.5 px-2.5", spotlight ? "hidden" : "flex")}>
        <Link
          href="/"
          aria-label="Back to library"
          title="Back to library"
          className="press flex size-7 shrink-0 items-center justify-center rounded-sm text-dim transition-colors duration-[var(--duration-fast)] hover:bg-tint hover:text-paper"
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
        <div className="ml-1 flex min-w-0 flex-1 items-center gap-2.5">
          <h1 className="flex h-7 min-w-0 max-w-[min(360px,50%)] shrink-0 items-center gap-2 rounded-full bg-panel-raised px-3 text-[13px] font-semibold text-paper shadow-chip">
            <BookOpen aria-hidden className="size-3.5 shrink-0 text-dim" />
            <span className="truncate">{title}</span>
          </h1>
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
          <Segmented label="Page colours" options={PDF_THEMES} value={pdfTheme} onChange={choosePdfTheme} />
        )}
        {/* A disabled button takes no pointer, so the reason it is off sits on this wrapper. */}
        <span title={book.format === "epub" ? undefined : "Spotlight works in EPUB books for now"} className="inline-flex">
          <IconButton
            label={
              book.format === "epub"
                ? `Spotlight: dim all but the paragraph you're reading (${SPOTLIGHT_SHORTCUT})`
                : "Spotlight works in EPUB books for now"
            }
            active={spotlight}
            disabled={book.format !== "epub" || !!error}
            onClick={toggleSpotlight}
          >
            <Focus />
          </IconButton>
        </span>
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
        className={clsx("min-h-0 flex-1", !spotlight && "px-2 pb-2")}
      >
        <ResizablePanel id="reader-panel" minSize="360px" className="min-w-0">
          <div ref={readerPaneRef} style={{ "--toc-width": `${TOC_WIDTH}px` } as CSSProperties} className="flex h-full min-w-0">
            {tocDocked && !error ? (
              <div
                inert={!tocOpen || spotlight}
                className="h-full shrink-0 overflow-hidden transition-[width] duration-[var(--duration-base)] ease-out"
                style={{ width: tocOpen && !spotlight ? TOC_WIDTH : 0 }}
              >
                <TocDrawer toc={toc} current={chapter} format={book.format} shortcut={TOC_SHORTCUT} open={tocOpen} docked onSelect={openEntry} onClose={closeToc} />
              </div>
            ) : null}
            <main
              ref={readerAreaRef}
              data-dark-pages={(book.format === "pdf" && pageTheme(pdfTheme) === "dark") || undefined}
              data-reading-theme={book.format === "epub" && epubTheme !== "auto" ? epubTheme : undefined}
              className={clsx("relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-page", !spotlight && "rounded-xl shadow-canvas")}
            >
              {annotations.error ? (
                <div
                  role="alert"
                  className="animate-rise absolute left-1/2 top-3 z-20 flex w-max max-w-[min(520px,calc(100%-24px))] -translate-x-1/2 items-start gap-2 rounded-lg bg-panel-raised py-2 pl-3 pr-1.5 text-label text-fog shadow-float"
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
                  <Link href="/" className="press mt-3 rounded-full bg-accent px-3.5 py-1.5 text-label font-semibold text-on-accent transition-colors duration-[var(--duration-fast)] hover:bg-accent/90">
                    Back to library
                  </Link>
                </EmptyState>
              ) : (
                <>
                  <div className="relative min-h-0 flex-1">
                    {book.format === "epub" ? <EpubReader {...readerProps} theme={pageTheme(epubTheme)} boldStarts={boldStarts} font={previewFont === undefined ? readingFont : previewFont} spotlight={spotlight} /> : <PdfReader {...readerProps} />}
                    {mode === "pages" ? (
                      <>
                        <PageTurn direction={-1} onTurn={turn} />
                        <PageTurn direction={1} onTurn={turn} />
                      </>
                    ) : null}
                  </div>
                  <ReadingFooter fraction={position?.fraction ?? 0} place={place} onSeek={(fraction) => {
                      dismissNotice();
                      readerRef.current?.seek(fraction);
                    }}
                  />
                </>
              )}
              {spotlight ? (
                <button
                  type="button"
                  onClick={toggleSpotlight}
                  title={`Leave the spotlight (Esc or ${SPOTLIGHT_SHORTCUT})`}
                  className="press animate-rise absolute right-3 top-3 z-30 inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-label text-page-dim/70 transition-colors duration-[var(--duration-fast)] hover:bg-prose/[0.06] hover:text-prose focus-visible:text-prose"
                >
                  <X className="size-3.5" aria-hidden />
                  Esc
                </button>
              ) : null}
              {notice && !spotlight && !reviewing ? (
                <OpeningNotice
                  notice={notice}
                  tutorReady={!!provider && !unavailable && !tutor.sending}
                  onRecap={recap}
                  onReview={startReview}
                  onClose={dismissNotice}
                />
              ) : null}
              {toast ? (
                <div
                  role="status"
                  className="animate-rise absolute bottom-14 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full bg-panel-raised py-0.5 pl-3.5 pr-1 text-label text-fog shadow-float"
                >
                  <span className="py-1">{toast.text}</span>
                  {toast.action ? (
                    <button
                      type="button"
                      onClick={() => {
                        showTab("chat");
                        setToast(null);
                      }}
                      className="press h-6 rounded-full px-2 text-label font-medium text-paper transition-colors duration-[var(--duration-fast)] hover:bg-tint-strong"
                    >
                      Show
                    </button>
                  ) : null}
                </div>
              ) : null}
              {reviewing ? <ReviewSheet cards={cards} onClose={() => setReviewing(false)} onJump={jumpTo} /> : null}
              {!tocDocked && !error ? (
                <TocDrawer toc={toc} current={chapter} format={book.format} shortcut={TOC_SHORTCUT} open={tocOpen && !spotlight} docked={false} onSelect={openEntry} onClose={closeToc} />
              ) : null}
            </main>
          </div>
        </ResizablePanel>
        <ResizableHandle
          aria-label="Resize the tutor panel"
          className="group relative z-10 w-2 shrink-0 outline-none before:absolute before:inset-y-3 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent before:transition-colors before:duration-[var(--duration-fast)] before:content-[''] focus-visible:before:bg-fog data-[dragging]:before:bg-line-strong data-[hovering]:before:bg-line-strong"
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
            onSendParked={sendParked}
            onReply={(draft) => provider && tutor.reply(draft, provider)}
            onRetry={() => provider && tutor.retry(provider)}
            annotations={annotations}
            noteDraft={noteDraft}
            noteFocus={noteFocus}
            onNoteDraft={setNoteDraft}
            onOpenNote={openNote}
            cards={cards}
            onReview={startReview}
          />
        </ResizablePanel>
      </Resizable>
      <SelectionToolbar
        ref={toolbarRef}
        bounds={readerBounds}
        readSelection={readSelection}
        disabledReason={unavailable}
        tutorBusy={tutor.sending}
        onAction={(action, selection) => startThread(action, selection, null)}
        onAsk={(text, selection, kind) => startThread(kind, selection, text)}
        onPark={(text, selection) => void park(selection, text)}
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
