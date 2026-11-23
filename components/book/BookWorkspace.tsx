"use client";

import { useCallback, useRef, useState, type CSSProperties } from "react";
import clsx from "clsx";
import { Resizable, ResizableHandle, ResizablePanel } from "@ui-sdk/react/resizable";
import { HighlightMenu } from "@/components/annotations/HighlightMenu";
import type { NoteDraft } from "@/components/annotations/NotesTab";
import { useAnnotations } from "@/components/annotations/useAnnotations";
import { ReviewSheet } from "@/components/cards/ReviewSheet";
import { useCards } from "@/components/cards/useCards";
import { dictationBusy } from "@/components/chat/useDictation";
import { useProviders } from "@/components/chat/useProviders";
import { useTutor, type MessageDraft } from "@/components/chat/useTutor";
import { EpubReader } from "@/components/reader/EpubReader";
import { PdfReader } from "@/components/reader/PdfReader";
import { SelectionToolbar, type SelectionToolbarHandle } from "@/components/reader/SelectionToolbar";
import type { OpenFailure } from "@/components/reader/errors";
import type { ReaderHandle, ReaderMeta, ReaderProps, SelectionRect, TocEntry } from "@/components/reader/types";
import { createStore, useStableCallback } from "@/components/ui/store";
import { useResolvedTheme } from "@/components/ui/theme";
import { patchBookState } from "@/lib/client/api";
import { hasUnsentText } from "@/lib/client/unsent";
import type { Anchor, BookFormat, BookId, BookState, PanelTab, ReadingFont, ReadingTheme, SelectionContext } from "@/lib/shared/types";
import { BookHeader, SPOTLIGHT_SHORTCUT, TOC_SHORTCUT } from "./BookHeader";
import { ErrorBanner, Toast, useToast } from "./FloatingMessages";
import { OpeningNotice, useNoticeExit } from "./OpeningNotice";
import type { PlaceStore, ReadingSpot } from "./place";
import { OpenFailed, PageTurn, SpotlightExit } from "./ReaderChrome";
import { ReadingFooter } from "./ReadingFooter";
import { SidePanel } from "./SidePanel";
import { TOC_WIDTH, TocDrawer, useTocDocked } from "./TocDrawer";
import { useBookSettings, type BookSettings } from "./useBookSettings";
import { useOpeningNotice } from "./useOpeningNotice";
import { usePositionSaver } from "./usePositionSaver";
import { useRefreshOnReturn } from "./useRefreshOnReturn";
import { useShortcuts, type Shortcut } from "./useShortcuts";
import { useSpotlight } from "./useSpotlight";
import { useTutorActions } from "./useTutorActions";
import { PANEL_ID, useTutorPanel } from "./useTutorPanel";

export interface WorkspaceBook {
  id: BookId;
  format: BookFormat;
  relPath: string;
  fileTitle: string;
}

export function BookWorkspace({ book, initialState, settings: saved }: { book: WorkspaceBook; initialState: BookState; settings: BookSettings }) {
  const readerRef = useRef<ReaderHandle>(null);
  const toolbarRef = useRef<SelectionToolbarHandle>(null);
  const readerAreaRef = useRef<HTMLElement>(null);
  const readerPaneRef = useRef<HTMLDivElement>(null);
  const panel = useTutorPanel();
  const [settings, choose, showUnsaved] = useBookSettings(saved);
  const { readingMode: mode, panelTab: tab, chaptersOpen: tocOpen, pdfPage: pdfTheme, epubPage: epubTheme } = settings;
  const [meta, setMeta] = useState({
    title: initialState.meta?.title ?? null,
    author: initialState.meta?.author ?? null,
  });
  /* The table of contents, null until the reader has opened the book. */
  const [toc, setToc] = useState<TocEntry[] | null>(null);
  const closeToc = useCallback(() => choose("chaptersOpen", false), [choose]);
  const tocDocked = useTocDocked(readerPaneRef);
  /* Reported on every scroll frame, so it lives outside state: only the chapter label, the footer and the
     chapters list subscribe, and everything else reads it when it needs it. */
  const [spot] = useState<PlaceStore>(() => createStore<ReadingSpot | null>(null));
  const [error, setError] = useState<OpenFailure | null>(null);
  const appTheme = useResolvedTheme();
  const pageTheme = (theme: ReadingTheme) => (theme === "auto" ? appTheme : theme);
  /* A font shown on the page while the reader looks through the list, before choosing one. */
  const [previewFont, setPreviewFont] = useState<ReadingFont | undefined>(undefined);
  const title = meta.title || book.fileTitle;
  const { save: savePosition, flush: flushPosition } = usePositionSaver(book.id, initialState.position);
  const readRevision = useCallback(async () => {
    const response = await fetch(`/api/books/${book.id}/revision`, { cache: "no-store" });
    return response.ok ? ((await response.json()) as { revision: string }).revision : null;
  }, [book.id]);
  const tutor = useTutor(book.id, initialState.threads, initialState.activeThreadId);
  const { providers, current: provider, choose: chooseProvider, models, chooseModel, unavailable } = useProviders(saved.provider, saved.models);
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
  const { notice, dismiss: dismissNotice, placeMoved, navigate } = useOpeningNotice({
    initialState,
    readerRef,
    spot,
    highlights: annotations.highlights,
    notes: annotations.notes,
  });
  const { on: spotlight, end: endSpotlight, toggle: toggleSpotlight } = useSpotlight(panel, book.format === "epub" && !error, dismissNotice);
  const noticeExit = useNoticeExit(notice, spotlight || reviewing);
  const [toast, setToast] = useToast();

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

  const chooseFont = (font: ReadingFont) => {
    setPreviewFont(undefined);
    choose("readingFont", font);
  };

  const chooseTab = useCallback((next: PanelTab) => choose("panelTab", next), [choose]);

  const showTab = (next: PanelTab) => {
    chooseTab(next);
    panel.expand();
  };

  const { startThread, askAnywhere, park, sendParked, recap } = useTutorActions({
    tutor,
    provider,
    readerRef,
    showTab,
    spot,
    onToast: setToast,
  });

  /* The greeting is hidden while reviewing, so it goes for good once a review starts. */
  const startReview = useCallback(() => {
    dismissNotice();
    setReviewing(true);
  }, [dismissNotice]);

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

  const openNote = useStableCallback((noteId: string) => {
    showTab("notes");
    setNoteFocus({ id: noteId, at: Date.now() });
  });

  /* The docked column stays open; the sliding one gets out of the way, which is not remembered as a choice. */
  const openEntry = useStableCallback((entry: TocEntry) => {
    if (!tocDocked) showUnsaved("chaptersOpen", false);
    navigate((reader) => reader.goToEntry(entry));
  });

  const turn = (direction: 1 | -1) => navigate((reader) => reader.turnPage(direction));

  const shortcuts: Shortcut[] = [
    { code: "Backslash", shift: false, run: panel.toggle },
    {
      code: "KeyL",
      shift: true,
      run: () => {
        if (!error) choose("chaptersOpen", !tocOpen);
      },
    },
    {
      code: "KeyH",
      shift: true,
      skipInText: true,
      run: () => {
        const selection = readerRef.current?.getSelection();
        if (selection) highlight(selection);
      },
    },
    { code: "KeyF", shift: true, skipInText: true, run: toggleSpotlight },
  ];
  useShortcuts({
    shortcuts,
    /* The review sheet has its own keys: Space, 1 to 4 and Esc. */
    plainKeysOff: reviewing,
    /* The highlight menu goes first and alone, so the same press doesn't also dismiss the greeting or the spotlight. */
    closeFirst: menu ? closeMenu : null,
    /* Esc takes one thing away at a time: the selection, then the greeting, then the spotlight. */
    onEscape: () => {
      const selected = !!readerRef.current?.getSelection();
      readerRef.current?.clearSelection();
      if (!selected) {
        if (notice) dismissNotice();
        else if (spotlight) toggleSpotlight();
      }
    },
    onPageKey: mode === "pages" ? turn : null,
    panelId: PANEL_ID,
  });

  const menuNote = menu ? annotations.notes.find((note) => note.highlightId === menu.id) : undefined;

  const jumpTo = useCallback((anchor: Anchor) => navigate((reader) => reader.goTo(anchor)), [navigate]);
  const seek = useCallback((fraction: number) => navigate((reader) => reader.seek(fraction)), [navigate]);
  const reply = useStableCallback((draft: MessageDraft) => provider && tutor.reply(draft, provider));
  const retry = useStableCallback(() => provider && tutor.retry(provider));

  const readerProps: ReaderProps = {
    ref: readerRef,
    bookId: book.id,
    initialPosition: initialState.position,
    onReady: handleReady,
    onSelectionChange: handleSelection,
    mode,
    onPositionChange: (next, nextPlace) => {
      spot.set({ position: next, place: nextPlace });
      savePosition(next);
      setMenu(null);
      placeMoved();
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
      <BookHeader
        title={title}
        spot={spot}
        format={book.format}
        failed={!!error}
        settings={settings}
        choose={choose}
        onToggleChapters={() => choose("chaptersOpen", !tocOpen)}
        onPreviewFont={setPreviewFont}
        onFont={chooseFont}
        providers={providers}
        provider={provider}
        onProvider={chooseProvider}
        models={models}
        onModel={chooseModel}
        spotlight={spotlight}
        onSpotlight={toggleSpotlight}
        panelId={PANEL_ID}
        panelOpen={panel.open}
        onTogglePanel={panel.toggle}
      />
      <Resizable
        controller={panel.layout}
        autoSaveId="rigg-learn.book-layout"
        onLayoutChange={panel.sync}
        className={clsx("min-h-0 flex-1", !spotlight && "px-2 pb-2")}
      >
        <ResizablePanel id="reader-panel" minSize="360px" className="min-w-0">
          <div ref={readerPaneRef} style={{ "--toc-width": `${TOC_WIDTH}px` } as CSSProperties} className="flex h-full min-w-0">
            {tocDocked && !error ? (
              <div
                inert={!tocOpen || spotlight}
                className="h-full shrink-0 overflow-hidden"
                style={{ width: tocOpen && !spotlight ? TOC_WIDTH : 0 }}
              >
                <TocDrawer toc={toc} spot={spot} format={book.format} shortcut={TOC_SHORTCUT} open={tocOpen} docked onSelect={openEntry} onClose={closeToc} />
              </div>
            ) : null}
            <main
              ref={readerAreaRef}
              data-dark-pages={(book.format === "pdf" && pageTheme(pdfTheme) === "dark") || undefined}
              data-reading-theme={book.format === "epub" && epubTheme !== "auto" ? epubTheme : undefined}
              className={clsx("relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-page", !spotlight && "rounded-xl shadow-canvas")}
            >
              {annotations.error ? <ErrorBanner message={annotations.error} onDismiss={annotations.dismissError} /> : null}
              {error ? (
                <OpenFailed failure={error} />
              ) : (
                <>
                  <div className="relative min-h-0 flex-1">
                    {book.format === "epub" ? <EpubReader {...readerProps} theme={pageTheme(epubTheme)} boldStarts={settings.boldStarts} font={previewFont === undefined ? settings.readingFont : previewFont} spotlight={spotlight} /> : <PdfReader {...readerProps} />}
                    {mode === "pages" ? (
                      <>
                        <PageTurn direction={-1} onTurn={turn} />
                        <PageTurn direction={1} onTurn={turn} />
                      </>
                    ) : null}
                  </div>
                  <ReadingFooter spot={spot} onSeek={seek} />
                </>
              )}
              {spotlight ? <SpotlightExit shortcut={SPOTLIGHT_SHORTCUT} onExit={toggleSpotlight} /> : null}
              {noticeExit.shown && !spotlight && !reviewing ? (
                <OpeningNotice
                  notice={noticeExit.shown}
                  tutorReady={!!provider && !unavailable && !tutor.sending}
                  onRecap={() => recap(noticeExit.shown?.resume, dismissNotice)}
                  onReview={startReview}
                  onClose={dismissNotice}
                  leaving={noticeExit.leaving}
                  onLeft={noticeExit.done}
                />
              ) : null}
              {toast ? (
                <Toast
                  toast={toast}
                  onShow={() => {
                    showTab("chat");
                    setToast(null);
                  }}
                />
              ) : null}
              {reviewing ? <ReviewSheet cards={cards} onClose={() => setReviewing(false)} onJump={jumpTo} /> : null}
              {!tocDocked && !error ? (
                <TocDrawer toc={toc} spot={spot} format={book.format} shortcut={TOC_SHORTCUT} open={tocOpen && !spotlight} docked={false} onSelect={openEntry} onClose={closeToc} />
              ) : null}
            </main>
          </div>
        </ResizablePanel>
        <ResizableHandle
          aria-label="Resize the tutor panel"
          className="group relative z-10 w-2 shrink-0 outline-none before:absolute before:left-1/2 before:top-1/2 before:h-10 before:w-[3px] before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:bg-transparent before:transition-colors before:duration-[var(--duration-fast)] before:content-[''] focus-visible:before:bg-fog data-[dragging]:before:bg-fog data-[hovering]:before:bg-line-strong"
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
            onReply={reply}
            onRetry={retry}
            annotations={annotations}
            noteDraft={noteDraft}
            noteFocus={noteFocus}
            onNoteDraft={setNoteDraft}
            onOpenNote={openNote}
            cards={cards}
            onReview={startReview}
            panelOpen={panel.open}
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
