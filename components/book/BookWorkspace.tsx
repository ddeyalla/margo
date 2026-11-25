"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState, type CSSProperties } from "react";
import clsx from "clsx";
import { Resizable, ResizableHandle, ResizablePanel } from "@ui-sdk/react/resizable";
import { HighlightMenu } from "@/components/annotations/HighlightMenu";
import { BoardPane } from "@/components/board/BoardPane";
import { OpenAsBoard } from "@/components/board/WhiteboardSheet";
import { useBoards } from "@/components/board/useBoards";
import type { NoteDraft } from "@/components/annotations/NotesTab";
import { useAnnotations } from "@/components/annotations/useAnnotations";
import { ReviewSheet } from "@/components/cards/ReviewSheet";
import { useCards } from "@/components/cards/useCards";
import { QuizNotice } from "@/components/quiz/QuizNotice";
import { QuizSheet } from "@/components/quiz/QuizSheet";
import { useQuizzes } from "@/components/quiz/useQuizzes";
import { addQuote, createQuoteDraft } from "@/components/chat/Quotes";
import { dictationBusy } from "@/components/chat/useDictation";
import { useProviders } from "@/components/chat/useProviders";
import { useTutor, type MessageDraft } from "@/components/chat/useTutor";
import { EpubReader } from "@/components/reader/EpubReader";
import { PdfReader } from "@/components/reader/PdfReader";
import { SelectionToolbar, type SelectionToolbarHandle } from "@/components/reader/SelectionToolbar";
import { useBookSearch } from "@/components/search/useBookSearch";
import type { OpenFailure } from "@/components/reader/errors";
import type { ReaderHandle, ReaderMeta, ReaderProps, SelectionRect, TocEntry } from "@/components/reader/types";
import { createStore, useStableCallback } from "@/components/ui/store";
import { useResolvedTheme } from "@/components/ui/theme";
import { patchBookState } from "@/lib/client/api";
import { hasUnsentText } from "@/lib/client/unsent";
import type { CourseContext } from "@/lib/shared/courses";
import { boardChapter } from "@/lib/shared/boards";
import { MAX_QUOTES_PER_MESSAGE } from "@/lib/shared/quotes";
import { tidyTitle, type Anchor, type BookFormat, type BookId, type BookState, type CardSet, type Highlight, type PanelTab, type QuotedPassage, type ReadingFont, type ReadingTheme, type SelectionContext } from "@/lib/shared/types";
import { BookHeader, SPOTLIGHT_SHORTCUT, TOC_SHORTCUT } from "./BookHeader";
import { ErrorBanner, Toast, useToast } from "./FloatingMessages";
import { OpeningNotice, useNoticeExit } from "./OpeningNotice";
import type { PlaceStore, ReadingSpot } from "./place";
import { FocusClock, FocusRecap } from "./FocusSession";
import { OpenFailed, PageTurn, SpotlightExit } from "./ReaderChrome";
import { ReadingFooter } from "./ReadingFooter";
import { SidePanel } from "./SidePanel";
import { TOC_WIDTH, TocDrawer, useTocDocked } from "./TocDrawer";
import { useActivity } from "./useActivity";
import { useBookSettings, type BookSettings } from "./useBookSettings";
import { useOpeningNotice } from "./useOpeningNotice";
import { usePositionSaver } from "./usePositionSaver";
import { useRefreshOnReturn } from "./useRefreshOnReturn";
import { useShortcuts, type Shortcut } from "./useShortcuts";
import { useSpotlight } from "./useSpotlight";
import { useFocusSession } from "./useFocusSession";
import { useTutorActions } from "./useTutorActions";
import { BOARD_PANE_ID, BOOK_PANE_ID, PANEL_ID, useTutorPanel } from "./useTutorPanel";

/** A sheet opened from a link leaves the link once closed, so a reload opens the book. */
/* The bar between two panes, drawn only while it's hovered, focused or dragged. */
const HANDLE =
  "group relative z-10 w-2 shrink-0 outline-none before:absolute before:left-1/2 before:top-1/2 before:h-10 before:w-[3px] before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:bg-transparent before:transition-colors before:duration-[var(--duration-fast)] before:content-[''] focus-visible:before:bg-fog data-[dragging]:before:bg-fog data-[hovering]:before:bg-line-strong";

const dropParam = (name: string) => {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(name)) return;
  url.searchParams.delete(name);
  window.history.replaceState(window.history.state, "", url);
};

export interface WorkspaceBook {
  id: BookId;
  format: BookFormat;
  relPath: string;
  fileTitle: string;
}

export function BookWorkspace({
  book,
  initialState,
  settings: saved,
  courses,
  openQuiz,
  openReview = false,
}: {
  book: WorkspaceBook;
  initialState: BookState;
  settings: BookSettings;
  /** The Courses that read this book, for its chapter quizzes. */
  courses: CourseContext[];
  /** A chapter whose quiz to open over the book at once. */
  openQuiz: string | null;
  /** Open the review at once, as Today's button asks. */
  openReview?: boolean;
}) {
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
  const quizzes = useQuizzes({ bookId: book.id, initial: initialState.quizzes, courses, spot, toc, provider });
  /* The chapter being read, as a board made now is about: the Course's chapter when a Course reads this book. */
  const boardContext = useStableCallback(() => {
    const entry = spot.get()?.place?.chapter ?? null;
    return toc && entry ? boardChapter(toc, toc.indexOf(entry), quizzes.chapters) : null;
  });
  const [toast, setToast] = useToast();
  const boardError = useStableCallback((text: string) => setToast({ text, action: false }));
  const boards = useBoards(book.id, initialState.boards, boardContext, boardError);
  const [reviewing, setReviewing] = useState(openReview);
  const [quizChapter, setQuizChapter] = useState<string | null>(openQuiz);
  /* What Draw it back folded away, the book and the tutor panel, to open again after. */
  const beforeRecall = useRef({ panel: false, book: false });
  useActivity(book.id, quizChapter ? "quiz" : reviewing ? "review" : "reading", spot);
  /* The highlight the reader clicked, with the menu that offers its note and removal. */
  const [menu, setMenu] = useState<{ id: string; rect: SelectionRect } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
  /* The same book open in another window: show its changes when this one comes back, unless this one is mid-answer, mid-note, mid-dictation, holding words typed but not sent, or has a whiteboard open (its saves and checks change the revision too). */
  useRefreshOnReturn(readRevision, flushPosition, () => tutor.sending || cards.jobs.length > 0 || noteDraft !== null || dictationBusy() || hasUnsentText() || boards.open !== null);
  const [noteFocus, setNoteFocus] = useState<{ id: string; at: number } | null>(null);
  const { notice, dismiss: dismissNotice, placeMoved, navigate } = useOpeningNotice({
    initialState,
    readerRef,
    spot,
    highlights: annotations.highlights,
    notes: annotations.notes,
  });
  const search = useBookSearch(book, navigate);
  const { on: spotlight, end: endSpotlight, toggle: toggleSpotlight } = useSpotlight(panel, book.format === "epub" && !error, dismissNotice);
  const focus = useFocusSession(book.id, title, panel);
  /* The spotlight and a focus session both clear the chrome away; only the spotlight dims the page. */
  const bare = spotlight || focus.active;
  const noticeExit = useNoticeExit(notice, bare || reviewing);
  /* Passages quoted into the chat's composer, waiting for the reader's next message. */
  const [quoteDraft] = useState(createQuoteDraft);

  /* The book's own title and author replace the file name once it has been opened. */
  const handleReady = (next: ReaderMeta) => {
    setToc(next.toc);
    const merged = { title: next.title ? tidyTitle(next.title) : meta.title, author: next.author ?? meta.author };
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

  /* A card that misleads the reader goes back to the tutor with its passage; the request says which cue misled. */
  const remakeCards = useStableCallback((set: CardSet) =>
    makeCards({ text: set.quote, before: "", after: "", anchor: set.anchor, chapterTitle: set.chapterTitle, rect: { top: 0, left: 0, width: 0, height: 0 } }),
  );

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
    { code: "KeyK", shift: false, run: search.open },
  ];
  useShortcuts({
    shortcuts,
    /* The review sheet has its own keys: Space, 1 to 4 and Esc. */
    /* A board keeps the page keys for the book beside it: keys pressed on the board itself never reach them. */
    plainKeysOff: reviewing || !!quizChapter,
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
  const closeQuiz = useCallback(() => {
    setQuizChapter(null);
    dropParam("quiz");
  }, []);
  const closeReview = useCallback(() => {
    setReviewing(false);
    dropParam("review");
  }, []);

  /* A citation leads to its passage, or says the book no longer has it there. */
  const findQuote = useCallback(
    async (quote: QuotedPassage) => {
      const reader = readerRef.current;
      if (!reader) return false;
      dismissNotice();
      const found = await reader.findPassage(quote.anchor, quote.text);
      if (!found) setToast({ text: "Couldn't find that passage in this copy of the book.", action: false });
      return found;
    },
    [dismissNotice, setToast],
  );

  /* A highlight goes into the chat's composer whole, as a chip that carries its anchor. */
  const quoteHighlight = useStableCallback((highlight: Highlight) => {
    const added = addQuote(quoteDraft, { anchor: highlight.anchor, text: highlight.quote, chapterTitle: highlight.chapterTitle });
    showTab("chat");
    if (added === "full") setToast({ text: `A message can quote up to ${MAX_QUOTES_PER_MESSAGE} passages.`, action: false });
  });
  const seek = useCallback((fraction: number) => navigate((reader) => reader.seek(fraction)), [navigate]);
  const reply = useStableCallback((draft: MessageDraft) => provider && tutor.reply(draft, provider));
  const retry = useStableCallback(() => provider && tutor.retry(provider));
  /* The recall from a focus session goes to the tutor as the reader's own message, to be checked against the book. */
  /* The board pane is open exactly while a board, or the list of them, is. */
  const boardPaneShown = boards.open !== null;
  const placeBoardPane = useEffectEvent((shown: boolean) => (shown ? panel.showBoard() : panel.hideBoard()));
  useEffect(() => placeBoardPane(boardPaneShown), [boardPaneShown]);
  /* Dragged shut, the pane closes its board, which saves it; the book is never folded away with nothing in its place. */
  const layoutChanged = () => {
    if (boards.open && panel.layout.isCollapsed(BOARD_PANE_ID)) boards.close();
    if (panel.layout.isCollapsed(BOOK_PANE_ID) && panel.layout.isCollapsed(BOARD_PANE_ID)) panel.showBook();
    panel.sync();
  };
  const toggleBook = () => (panel.isBookOpen() ? panel.hideBook() : panel.showBook());

  /* Draw it back closes the book, the chat included, and opens them again after. */
  const recallBoard = (active: boolean) => {
    if (active) {
      beforeRecall.current = { panel: panel.isOpen(), book: panel.isBookOpen() };
      panel.collapse();
      panel.hideBook();
    } else {
      if (beforeRecall.current.panel) panel.expand();
      if (beforeRecall.current.book) panel.showBook();
    }
  };

  const openDiagram = useStableCallback((source: string) => void boards.fromDiagram(source));
  /* A message from a board goes to the open thread, or starts one at the reader's place when none is open. */
  const sayFromBoard = (text: string) => {
    showTab("chat");
    const draft = { text, attachments: [], quotes: [] };
    if (tutor.active) reply(draft);
    else askAnywhere(draft);
  };
  const answerFromBoard = useStableCallback(sayFromBoard);
  /* Asked from the Board tab, the tutor draws in the chat, where its diagram opens as a board. */
  const drawInChat = useStableCallback((what: string) => sayFromBoard(`Draw this as a whiteboard for me: ${what}`));

  const askRecall = (text: string, minutes: number) => {
    showTab("chat");
    reply({
      text: `I just finished a ${minutes}-minute reading session. From memory, the ideas worth keeping:\n\n${text}\n\nDid I get them right? Correct anything I misremembered and tell me what I missed.`,
      attachments: [],
      quotes: [],
    });
    focus.dismiss(true);
  };

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
      search.placed();
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
        focusing={focus.active}
        onFocus={focus.start}
        boardOpen={boardPaneShown}
        onBoard={() => (boards.open ? boards.close() : boards.list())}
        panelId={PANEL_ID}
        panelOpen={panel.open}
        onTogglePanel={panel.toggle}
        onSearch={search.open}
      />
      <Resizable
        controller={panel.layout}
        autoSaveId="rigg-learn.book-layout.v2"
        onLayoutChange={layoutChanged}
        className={clsx("min-h-0 flex-1", !bare && "px-2 pb-2")}
      >
        <ResizablePanel id={BOOK_PANE_ID} minSize="360px" collapsible className="min-w-0">
          <div ref={readerPaneRef} style={{ "--toc-width": `${TOC_WIDTH}px` } as CSSProperties} className="flex h-full min-w-0">
            {tocDocked && !error ? (
              <div
                inert={!tocOpen || bare}
                className="h-full shrink-0 overflow-hidden"
                style={{ width: tocOpen && !bare ? TOC_WIDTH : 0 }}
              >
                <TocDrawer toc={toc} spot={spot} format={book.format} shortcut={TOC_SHORTCUT} open={tocOpen} docked onSelect={openEntry} onClose={closeToc} />
              </div>
            ) : null}
            <main
              ref={readerAreaRef}
              data-dark-pages={(book.format === "pdf" && pageTheme(pdfTheme) === "dark") || undefined}
              data-reading-theme={book.format === "epub" && epubTheme !== "auto" ? epubTheme : undefined}
              className={clsx("relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-page", !bare && "rounded-xl shadow-canvas")}
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
              {focus.session.phase === "running" || focus.session.phase === "starting" ? (
                <FocusClock
                  remaining={focus.remaining}
                  blocking={focus.session.phase === "running" ? focus.session.blocking : null}
                  starting={focus.session.phase === "starting"}
                  onEnd={focus.end}
                />
              ) : null}
              {focus.session.phase === "done" ? (
                <FocusRecap
                  minutes={focus.session.minutes}
                  early={focus.session.early}
                  askBlocked={!provider ? "Choose a tutor first" : (unavailable ?? (tutor.sending ? "The tutor is still answering" : null))}
                  onAsk={(text) => askRecall(text, focus.session.phase === "done" ? focus.session.minutes : 0)}
                  onSkip={() => focus.dismiss()}
                />
              ) : null}
              {noticeExit.shown && !bare && !reviewing ? (
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
              {reviewing ? <ReviewSheet cards={cards} onClose={closeReview} onJump={jumpTo} /> : null}
              {quizzes.active && !reviewing && !quizChapter && !spotlight && !noticeExit.shown ? (
                <QuizNotice
                  quizzes={quizzes}
                  onTake={(chapter) => {
                    quizzes.dismissFinished();
                    setQuizChapter(chapter);
                  }}
                />
              ) : null}
              {quizChapter && !reviewing ? <QuizSheet quizzes={quizzes} chapter={quizChapter} onClose={closeQuiz} onJump={jumpTo} /> : null}
              {!tocDocked && !error ? (
                <TocDrawer toc={toc} spot={spot} format={book.format} shortcut={TOC_SHORTCUT} open={tocOpen && !bare && !reviewing && !quizChapter} docked={false} onSelect={openEntry} onClose={closeToc} />
              ) : null}
            </main>
          </div>
        </ResizablePanel>
        <ResizableHandle aria-label="Resize the whiteboard" disabled={!panel.boardOpen} className={clsx(HANDLE, !panel.boardOpen && "w-0")} />
        <ResizablePanel id={BOARD_PANE_ID} defaultSize="0px" minSize="400px" collapsible className="min-w-0 overflow-hidden">
          {/* Drawn only while open: a canvas in a closed pane has no size. */}
          {boardPaneShown && panel.boardOpen ? (
            <div data-board-pane className={clsx("flex h-full min-w-0 flex-col overflow-hidden bg-page", !bare && "rounded-xl shadow-canvas")}>
              <BoardPane
                boards={boards}
                bookId={book.id}
                spot={spot}
                context={boardContext}
                provider={provider}
                unavailable={unavailable}
                theme={appTheme}
                bookShown={panel.bookOpen}
                onToggleBook={toggleBook}
                onRecall={recallBoard}
                onDraw={drawInChat}
                onAnswer={answerFromBoard}
              />
            </div>
          ) : null}
        </ResizablePanel>
        <ResizableHandle aria-label="Resize the tutor panel" className={HANDLE} />
        <ResizablePanel
          id={PANEL_ID}
          defaultSize="380px"
          minSize="300px"
          maxSize="50%"
          collapsible
          className="min-w-0 overflow-hidden"
        >
          <OpenAsBoard value={openDiagram}>
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
              quotes={quoteDraft}
              onFindQuote={findQuote}
              onQuote={quoteHighlight}
              cards={cards}
              onReview={startReview}
              onRemakeCards={provider ? remakeCards : null}
              panelOpen={panel.open}
            />
          </OpenAsBoard>
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
          onQuote={() => {
            const clicked = annotations.highlights.find((h) => h.id === menu.id);
            if (clicked) quoteHighlight(clicked);
            setMenu(null);
          }}
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
      {search.dialog}
    </div>
  );
}
