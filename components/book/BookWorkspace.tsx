"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CircleAlert, FileWarning, Moon, PanelRight, X } from "lucide-react";
import { createResizableController, Resizable, ResizableHandle, ResizablePanel } from "@ui-sdk/react/resizable";
import { HighlightMenu } from "@/components/annotations/HighlightMenu";
import type { NoteDraft } from "@/components/annotations/NotesTab";
import { useAnnotations } from "@/components/annotations/useAnnotations";
import { useProviders } from "@/components/chat/useProviders";
import { useTutor } from "@/components/chat/useTutor";
import { EpubReader } from "@/components/reader/EpubReader";
import { PdfReader } from "@/components/reader/PdfReader";
import { SelectionToolbar, type SelectionToolbarHandle } from "@/components/reader/SelectionToolbar";
import type { OpenFailure } from "@/components/reader/errors";
import type { ReaderHandle, ReaderMeta, SelectionRect } from "@/components/reader/types";
import { EmptyState, IconButton } from "@/components/ui";
import { patchBookState, patchSettings } from "@/lib/client/api";
import { placeLabel } from "@/lib/shared/place";
import type { Anchor, BookFormat, BookId, BookState, ProviderId, SelectionContext, TutorAction } from "@/lib/shared/types";
import { SidePanel, type PanelTab } from "./SidePanel";
import { usePositionSaver } from "./usePositionSaver";

export interface WorkspaceBook {
  id: BookId;
  format: BookFormat;
  relPath: string;
  fileTitle: string;
}

const PANEL_ID = "tutor-panel";

/** Typing here keeps its own keys, such as Esc in the note editor or ⌘⇧H in a question. */
const isTextEntry = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"));

export function BookWorkspace({
  book,
  initialState,
  savedProvider,
  savedDarkPages,
}: {
  book: WorkspaceBook;
  initialState: BookState;
  savedProvider: ProviderId | null;
  savedDarkPages: boolean;
}) {
  const readerRef = useRef<ReaderHandle>(null);
  const toolbarRef = useRef<SelectionToolbarHandle>(null);
  const readerAreaRef = useRef<HTMLElement>(null);
  const [layout] = useState(createResizableController);
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState<PanelTab>("chat");
  const [meta, setMeta] = useState<ReaderMeta>({
    title: initialState.meta?.title ?? null,
    author: initialState.meta?.author ?? null,
  });
  const [chapter, setChapter] = useState<string | null>(null);
  const [error, setError] = useState<OpenFailure | null>(null);
  const [darkPages, setDarkPages] = useState(savedDarkPages);
  const title = meta.title || book.fileTitle;
  const savePosition = usePositionSaver(book.id);
  const tutor = useTutor(book.id, initialState.threads);
  const { providers, current: provider, choose: chooseProvider, unavailable } = useProviders(savedProvider);
  const annotations = useAnnotations(book.id, { highlights: initialState.highlights, notes: initialState.notes }, readerRef);
  /* The highlight the reader clicked, with the menu that offers its note and removal. */
  const [menu, setMenu] = useState<{ id: string; rect: SelectionRect } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
  const [noteFocus, setNoteFocus] = useState<{ id: string; at: number } | null>(null);

  /* A layout restored from an earlier visit may start with the panel collapsed; read it once the group has attached. */
  useEffect(() => {
    const frame = requestAnimationFrame(() => setPanelOpen(!layout.isCollapsed(PANEL_ID)));
    return () => cancelAnimationFrame(frame);
  }, [layout]);

  /* The book's own title and author replace the file name once it has been opened. */
  const handleReady = (next: ReaderMeta) => {
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

  const toggleDarkPages = () => {
    setDarkPages(!darkPages);
    void patchSettings({ pdfDarkPages: !darkPages });
  };

  const showTab = (next: PanelTab) => {
    setTab(next);
    if (layout.isCollapsed(PANEL_ID)) layout.expand(PANEL_ID);
  };

  const startThread = (action: TutorAction, selection: SelectionContext, question: string | null) => {
    if (!provider) return;
    readerRef.current?.clearSelection();
    showTab("chat");
    tutor.start(action, selection, question, provider);
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

  const openNote = (noteId: string) => {
    showTab("notes");
    setNoteFocus({ id: noteId, at: Date.now() });
  };

  /* Keys from the EPUB's frame are forwarded here too. */
  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.shiftKey && !event.altKey && event.code === "Backslash") {
      event.preventDefault();
      togglePanel();
    } else if (mod && event.shiftKey && !event.altKey && event.code === "KeyH" && !isTextEntry(event.target)) {
      event.preventDefault();
      const selection = readerRef.current?.getSelection();
      if (selection) highlight(selection);
    } else if (event.key === "Escape" && !isTextEntry(event.target)) {
      readerRef.current?.clearSelection();
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onShortcut(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const menuNote = menu ? annotations.notes.find((note) => note.highlightId === menu.id) : undefined;

  const jumpTo = (anchor: Anchor) => void readerRef.current?.goTo(anchor);

  const Reader = book.format === "epub" ? EpubReader : PdfReader;

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
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h1 className="truncate text-[13px] font-medium text-paper">{title}</h1>
          {chapter ? <span className="truncate text-label text-dim">{chapter}</span> : null}
        </div>
        {book.format === "pdf" ? (
          <IconButton label={darkPages ? "Show pages in their own colours" : "Show white pages dark"} active={darkPages} onClick={toggleDarkPages}>
            <Moon />
          </IconButton>
        ) : null}
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
          <main ref={readerAreaRef} data-dark-pages={darkPages || undefined} className="relative h-full min-w-0">
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
              <Reader
                ref={readerRef}
                bookId={book.id}
                initialPosition={initialState.position}
                onReady={handleReady}
                onSelectionChange={handleSelection}
                onPositionChange={(position, chapterTitle) => {
                  setChapter(placeLabel(chapterTitle, position));
                  savePosition(position);
                  setMenu(null);
                }}
                onError={setError}
                onHighlightClick={(id, rect) => setMenu({ id, rect })}
              />
            )}
          </main>
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
            onTabChange={setTab}
            tutor={tutor}
            providers={providers}
            provider={provider}
            unavailable={unavailable}
            onProvider={chooseProvider}
            onJump={jumpTo}
            onReply={(text) => provider && tutor.reply(text, provider)}
            onRetry={() => provider && tutor.retry(provider)}
            annotations={annotations}
            noteDraft={noteDraft}
            noteFocus={noteFocus}
            onNoteDraft={setNoteDraft}
            onOpenNote={openNote}
          />
        </ResizablePanel>
      </Resizable>
      <SelectionToolbar
        ref={toolbarRef}
        bounds={readerBounds}
        readSelection={readSelection}
        disabledReason={unavailable}
        onAction={(action, selection) => startThread(action, selection, null)}
        onAsk={(question, selection) => startThread("ask", selection, question)}
        onHighlight={highlight}
        onNote={writeNote}
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
