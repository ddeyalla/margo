"use client";

import "@excalidraw/excalidraw/index.css";
import { CaptureUpdateAction, Excalidraw, exportToBlob, hashElementsVersion, MainMenu, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Check, ChevronDown, ChevronLeft, Eye, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, RotateCcw, X } from "lucide-react";
import { Button, IconButton, Divider, PaneHeader, Spinner } from "@/components/ui";
import { compactScene, diagramOps, isSuggestion, type BoardCheck, type BoardOp, type BoardReview, type OpenedBoard } from "@/lib/shared/boards";
import type { BookId, ProviderId } from "@/lib/shared/types";
import { askBoard, fetchBoard, putBoard, settling, type BoardRequest } from "./api";
import { useBoardLink, type OpenBoard } from "./link";
import { remeasureText } from "./remeasure";
import { acceptSuggestion, pendingSuggestions, readerElements, rejectSuggestion, SUGGESTION_COLOR, suggestionsFor, type Suggestion } from "./suggestions";

/* Excalidraw fetches its fonts from a CDN unless told where they are; the app serves its own copies, offline. */
if (typeof window !== "undefined") (window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = "/vendor/excalidraw/";

export interface WhiteboardProps {
  bookId: BookId;
  boardId: string;
  provider: ProviderId | null;
  /** Why the tutor can't be asked right now, or null. */
  unavailable: string | null;
  theme: "light" | "dark";
  /** Draw it back closes the book: the tutor panel folds away while it lasts. */
  onRecall(active: boolean): void;
  /** Puts words in the chat's composer, with the board attached, for the reader to finish and send. */
  onAnswer(text: string): void;
  /** The book is beside the board, rather than hidden for the board to take its room. */
  bookShown: boolean;
  /** Which side of the book the board is on. */
  side: "left" | "right";
  onToggleBook(): void;
  /** Moves the board to the other side of the book. Its edits save as it moves. */
  onSwap(): void;
  /** Back to the list of boards, once the edits are saved. */
  onBack(): void;
  onClose(): void;
  /**
   * Sets the board's leaving check, which every change of board waits for: it saves the board and says whether it may
   * go. Null when the board goes.
   */
  guard(leave: (() => Promise<boolean>) | null): void;
}

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; board: OpenedBoard; key: number };
type Save = { state: "saved" | "saving" | "unsaved" } | { state: "failed"; error: string } | { state: "conflict"; copy: string };
type Busy = "review" | "check" | null;

const SAVE_DELAY_MS = 1200;

const initialData = (board: OpenedBoard | null): ExcalidrawInitialDataState => {
  if (!board?.file) return { elements: [], scrollToContent: true };
  try {
    const saved = JSON.parse(board.file.text) as ExcalidrawInitialDataState;
    return {
      elements: saved.elements ?? [],
      appState: {
        viewBackgroundColor: saved.appState?.viewBackgroundColor,
        gridSize: saved.appState?.gridSize,
      },
      files: saved.files,
      scrollToContent: true,
    };
  } catch {
    return { elements: [], scrollToContent: true };
  }
};

const base64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** The reader's drawing as a PNG for the tutor to look at, scaled down, on white. */
const picture = async (api: ExcalidrawImperativeAPI): Promise<string | null> => {
  const elements = readerElements(api.getSceneElements());
  if (!elements.length) return null;
  try {
    const blob = await exportToBlob({
      elements,
      appState: {
        ...api.getAppState(),
        exportBackground: true,
        exportWithDarkMode: false,
        viewBackgroundColor: "#ffffff",
      },
      files: api.getFiles(),
      mimeType: "image/png",
      maxWidthOrHeight: 1600,
    });
    return await base64(blob);
  } catch {
    return null;
  }
};

/**
 * What a save writes, as one comparable value: the elements, the canvas settings that are saved with them, and which
 * pictures are stored. A change to any of them is an edit to save.
 */
const drawingVersion = (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) =>
  `${hashElementsVersion(elements)}:${appState.viewBackgroundColor}:${appState.gridSize ?? ""}:${Object.keys(files).sort().join(",")}`;

const pendingKey = (list: readonly Suggestion[]) => list.map((s) => s.id).join(",");

/**
 * A whiteboard in its own pane, beside the book or in its place, with the chat still open. The reader draws; the
 * board saves itself to the notes folder as they go. The chat is where the board is talked about: while it is open
 * the composer sends it with each message, and the tutor's changes come back on the board as suggestions, kept or
 * dropped from the bar at its foot. A chapter's board can also be reviewed against its chapter. "Draw it back"
 * swaps in a blank board with the book closed: redrawn from memory, the tutor points at the first link that doesn't
 * hold, and says nothing more.
 */
export default function Whiteboard(props: WhiteboardProps) {
  const { bookId, boardId, provider, unavailable, theme, bookShown, side, onRecall, onAnswer, onToggleBook, onSwap, onBack, onClose, guard } = props;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [mode, setMode] = useState<"board" | "recall">("board");
  const [save, setSave] = useState<Save>({ state: "saved" });
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [review, setReview] = useState<{
    review: BoardReview;
    ids: Record<string, string>;
  } | null>(null);
  const [check, setCheck] = useState<{
    check: BoardCheck;
    ids: Record<string, string>;
  } | null>(null);
  const [pending, setPending] = useState<Suggestion[]>([]);
  const link = useBoardLink();

  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const hash = useRef<string | null>(null);
  /* The version of the reader's drawing last saved or opened; null until the board first reports. */
  const savedVersion = useRef<string | null>(null);
  /** The drawing whose save just failed: it waits for the next edit rather than retrying on every pointer move. */
  const failedVersion = useRef<string | null>(null);
  /**
   * The board as it last reported itself, which is what a save writes. Never read back from the canvas: by the time a
   * closing board saves, Excalidraw has already emptied its scene.
   */
  const latest = useRef<{
    elements: readonly ExcalidrawElement[];
    appState: AppState;
    files: BinaryFiles;
  } | null>(null);
  /** The version of the drawing as last reported, or null before it first reports. */
  const latestVersion = () => {
    const board = latest.current;
    return board && drawingVersion(readerElements(board.elements.filter((element) => !element.isDeleted)), board.appState, board.files);
  };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const conflicted = useRef(false);
  const aborter = useRef<AbortController | null>(null);
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  /* Where the board is saved, shown beside the save state. */
  const [path, setPath] = useState<string | null>(null);

  /* Only the latest opening lands: an earlier one answering late would put the canvas back as it was. */
  const opening = useRef(0);
  const fetchInto = useCallback(() => {
    const ticket = ++opening.current;
    return fetchBoard(bookId, boardId).then(
      (board) => {
        if (ticket !== opening.current) return;
        hash.current = board.file?.hash ?? null;
        savedVersion.current = null;
        latest.current = null;
        conflicted.current = false;
        setPath(board.file ? board.board.path : null);
        setSave({ state: "saved" });
        setLoad((current) => ({
          state: "ready",
          board,
          key: (current.state === "ready" ? current.key : 0) + 1,
        }));
      },
      (failure: unknown) => {
        /* Work waiting for this board to open won't be done. */
        if (ticket === opening.current) link?.cancel(null);
        if (ticket === opening.current)
          setLoad({
            state: "failed",
            error: failure instanceof Error ? failure.message : "The board couldn't be opened.",
          });
      },
    );
  }, [bookId, boardId, link]);

  useEffect(() => {
    void fetchInto();
  }, [fetchInto]);

  /** Opens the board again from its file. */
  const open = () => {
    setLoad({ state: "loading" });
    void fetchInto();
  };

  /**
   * Saves the reader's drawing until what is saved is what was last drawn, one save at a time; after a conflict, none.
   * True when the drawing is safe: in its file, in the conflict copy beside it, or with nothing to save. False when a
   * save failed.
   */
  const flush = useCallback(
    async (keepalive = false): Promise<boolean> => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      for (;;) {
        /* Another caller may have started the next save while this one waited: wait again until none is running. */
        while (inFlight.current) await inFlight.current;
        const board = latest.current;
        /* The canvas stops taking edits at a conflict, and the drawing is in the copy beside the file. */
        if (conflicted.current) return true;
        if (!board || modeRef.current !== "board") return true;
        const elements = readerElements(board.elements.filter((element) => !element.isDeleted));
        const version = drawingVersion(elements, board.appState, board.files);
        if (version === savedVersion.current) return true;
        const text = serializeAsJSON(elements, board.appState, board.files, "local");
        setSave({ state: "saving" });
        let ok = false;
        const run = putBoard(bookId, { id: boardId, text, baseHash: hash.current }, keepalive).then(
          (result) => {
            if (result.state === "saved") {
              hash.current = result.hash;
              savedVersion.current = version;
              failedVersion.current = null;
              ok = true;
              setPath(result.path);
              /* An edit made while this save was out is still unsaved; the loop saves it next. */
              setSave({ state: latestVersion() === version ? "saved" : "unsaved" });
            } else {
              conflicted.current = true;
              ok = true;
              setSave({ state: "conflict", copy: result.copy });
            }
          },
          (failure: unknown) => {
            failedVersion.current = version;
            setSave({
              state: "failed",
              error: failure instanceof Error ? failure.message : "The board couldn't be saved.",
            });
          },
        );
        inFlight.current = run.finally(() => {
          inFlight.current = null;
        });
        await inFlight.current;
        if (!ok) return false;
      }
    },
    [bookId, boardId],
  );

  const onChange = (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
    const list = pendingSuggestions(elements);
    if (mode === "board" && savedVersion.current !== null) undecided.current = elements.filter((element) => !element.isDeleted && isSuggestion(element));
    setPending((current) => (pendingKey(current) === pendingKey(list) ? current : list));
    /* After a conflict the canvas is read-only until the reader opens the file's version, so nothing drawn is dropped. */
    if (mode !== "board" || conflicted.current) return;
    latest.current = { elements, appState, files };
    const version = latestVersion()!;
    if (savedVersion.current === null) {
      savedVersion.current = version;
      /* Suggestions left undecided when this board last closed come back with it. */
      const held = link?.held.get(boardId);
      if (held?.length && api.current) {
        link?.held.delete(boardId);
        api.current.updateScene({ elements: [...elements, ...held], captureUpdate: CaptureUpdateAction.NEVER });
      }
      /* The whole drawing in view when it opens, however small the panel. */
      const live = elements.filter((element) => !element.isDeleted);
      if (live.length && api.current) {
        api.current.scrollToContent(live, { fitToViewport: true, viewportZoomFactor: 0.85 });
        void remeasureText(api.current);
      }
      link?.attach(handle.current);
      return;
    }
    if (version === savedVersion.current || version === failedVersion.current) return;
    setSave((current) => (current.state === "unsaved" ? current : { state: "unsaved" }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  };

  /* Whatever is unsaved goes out as the board closes, the page included. */
  useEffect(() => {
    const onHide = () => void flush(true);
    addEventListener("pagehide", onHide);
    return () => {
      removeEventListener("pagehide", onHide);
      aborter.current?.abort();
      settling(bookId, boardId, flush(true));
    };
  }, [flush, bookId, boardId]);

  /** Puts the tutor's changes on the board as suggestions, through the ids they were written against. */
  const suggest = (ops: readonly BoardOp[], ids: Record<string, string>) => {
    const board = api.current;
    if (!board) return { added: 0, dropped: ops.length };
    const { added, dropped } = suggestionsFor(ops, ids, board.getSceneElementsIncludingDeleted());
    if (added.length) {
      board.updateScene({ elements: [...board.getSceneElementsIncludingDeleted(), ...added], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      board.scrollToContent(added, { animate: true, fitToViewport: true, viewportZoomFactor: 0.8 });
      /* Their labels were measured as they were made, maybe before the hand font was ready: measured again, none draws clipped. */
      void remeasureText(board);
    }
    setNotice(
      dropped
        ? `${dropped} suggestion${dropped === 1 ? " was" : "s were"} left out: ${dropped === 1 ? "it was" : "they were"} about something you changed meanwhile.`
        : null,
    );
    return { added: new Set(added.map((element) => element.customData?.suggestion)).size, dropped };
  };

  /**
   * Puts a chat diagram on the board. A flowchart goes on as suggestions, reusing the ideas already drawn, so a
   * diagram that corrects or grows the board adds only what is new; a kind that comes in as one picture goes on as it is.
   */
  const addDiagram = async (source: string) => {
    const board = api.current;
    if (!board) return { added: 0, dropped: 0 };
    const { mermaidElements } = await import("./mermaid");
    const current = board.getSceneElements();
    const { elements, files } = await mermaidElements(source, readerElements(current));
    const drawn = compactScene(elements).scene;
    if (!drawn.nodes.length) {
      if (!elements.length) throw new Error("The diagram had nothing to draw.");
      if (files.length) board.addFiles(files);
      board.updateScene({ elements: [...board.getSceneElementsIncludingDeleted(), ...elements], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      board.scrollToContent(elements, { animate: true, fitToViewport: true, viewportZoomFactor: 0.8 });
      return { added: elements.length ? 1 : 0, dropped: 0 };
    }
    const { scene, ids } = compactScene(current);
    return suggest(diagramOps(drawn, scene), ids);
  };

  /* The board as the chat reaches it: read and changed only while it is the reader's board, not a draw-it-back. */
  const titleRef = useRef("Whiteboard");
  const suggestRef = useRef(suggest);
  const addDiagramRef = useRef(addDiagram);
  useEffect(() => {
    suggestRef.current = suggest;
    addDiagramRef.current = addDiagram;
  });
  const handle = useRef<OpenBoard>({
    id: boardId,
    get title() {
      return titleRef.current;
    },
    mention: () => ({ id: boardId, title: titleRef.current, ...compactScene(api.current?.getSceneElements() ?? []) }),
    suggest: (ops, ids) => suggestRef.current(ops, ids),
    addDiagram: (source) => addDiagramRef.current(source),
  });
  /* Suggestions aren't saved until kept; ones still undecided as the board closes wait for it in the link. */
  const undecided = useRef<readonly ExcalidrawElement[]>([]);
  useEffect(
    () => () => {
      if (link && undecided.current.length) link.held.set(boardId, undecided.current);
    },
    [link, boardId],
  );
  useEffect(() => {
    const ours = handle.current;
    if (mode === "recall") link?.attach(null);
    return () => {
      if (link?.open.get() === ours) link.attach(null);
    };
  }, [link, mode]);

  const ask = async (kind: "review" | "check") => {
    const board = api.current;
    if (!board || !provider || busy) return;
    const { scene, ids } = compactScene(board.getSceneElements());
    if (kind === "check" && !scene.links.length) {
      setError("Join the ideas with arrows first: the check is about how they connect.");
      return;
    }
    if (kind === "review" && !scene.nodes.length) {
      setError("Draw a few of the chapter’s ideas first, in boxes or as text.");
      return;
    }
    setBusy(kind);
    setError(null);
    setNotice(null);
    aborter.current = new AbortController();
    const base = {
      id: boardId,
      provider,
      scene,
      image: await picture(board),
    };
    const body: BoardRequest = { op: kind, ...base };
    try {
      const reply = await askBoard(bookId, body, aborter.current.signal);
      if (reply.kind === "check") {
        setCheck({ check: reply.check, ids });
        const wrong = reply.check.wrong && ids[reply.check.wrong.link];
        if (wrong) show(wrong);
        return;
      }
      setReview({ review: reply.review, ids });
      suggest(reply.review.ops, ids);
    } catch (failure) {
      if (!aborter.current?.signal.aborted) setError(failure instanceof Error ? failure.message : "The tutor couldn't answer.");
    } finally {
      setBusy(null);
    }
  };

  /** Selects an element and brings it into view. */
  const show = (id: string) => {
    const board = api.current;
    const element = board?.getSceneElements().find((e) => e.id === id);
    if (!board || !element) return;
    board.updateScene({
      appState: { selectedElementIds: { [id]: true } },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    board.scrollToContent(element, { animate: true });
  };

  const decide = (id: string | null, accept: boolean) => {
    const board = api.current;
    if (!board) return;
    let elements: readonly ExcalidrawElement[] = board.getSceneElementsIncludingDeleted();
    for (const suggestion of id ? [id] : pendingSuggestions(elements).map((s) => s.id)) {
      elements = accept ? acceptSuggestion(elements, suggestion) : rejectSuggestion(elements, suggestion);
    }
    board.updateScene({
      elements,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  /** What stops the board from being left: its last save failed or conflicted, with what the reader was doing. */
  const [stuck, setStuck] = useState<"close" | "back" | "recall" | null>(null);

  const startRecall = async () => {
    if (!(await flush())) {
      setStuck("recall");
      return;
    }
    setStuck(null);
    /* Suggestions still undecided come back with the board after the draw-it-back. */
    if (link && undecided.current.length) link.held.set(boardId, undecided.current);
    aborter.current?.abort();
    setReview(null);
    setCheck(null);
    setError(null);
    setNotice(null);
    setMode("recall");
    onRecall(true);
  };

  const endRecall = () => {
    aborter.current?.abort();
    setCheck(null);
    setError(null);
    setMode("board");
    onRecall(false);
    open();
  };

  /*
   * However the board is left (its own buttons, the header, another board opened, the pane dragged shut), it saves
   * first; a board whose save fails stays open with the drawing, unless the reader chooses to leave without it.
   */
  const discard = useRef(false);
  const leaving = useRef<(() => Promise<boolean>) | null>(null);
  leaving.current = async () => {
    if (!discard.current && !(await flush())) {
      setStuck((current) => current ?? "close");
      return false;
    }
    discard.current = false;
    setStuck(null);
    if (modeRef.current === "recall") onRecall(false);
    return true;
  };
  useEffect(() => {
    guard(() => leaving.current!());
    return () => guard(null);
  }, [guard]);
  const leave = (how: "close" | "back", anyway = false) => {
    discard.current = anyway;
    setStuck(how);
    if (how === "close") onClose();
    else onBack();
  };
  const close = (anyway = false) => leave("close", anyway);
  const back = (anyway = false) => leave("back", anyway);

  const board = load.state === "ready" ? load.board.board : null;
  const title = board?.title ?? "Whiteboard";
  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  /* Saved is the quiet default and says nothing; the file's place is in the title's tooltip. */
  const saveLine =
    save.state === "saving" ? "Saving…" : save.state === "unsaved" ? "Edited" : save.state === "failed" ? save.error : save.state === "conflict" ? "Not saved" : "";
  /* The tutor reads a board against its chapter: a board about none can still be talked about in the chat. */
  const chapterBoard = !!board?.chapter && mode === "board";
  const askBlocked = !provider ? (unavailable ?? "No tutor is available.") : null;
  /* The side opens only when the tutor has something to show there. */
  const railShown = mode === "recall" || (mode === "board" && (!!review || busy === "review"));
  const canvas = (
    <div className="board-canvas relative min-w-0 flex-1">
      {load.state === "ready" ? (
        <Excalidraw
          key={`${mode}:${load.key}`}
          excalidrawAPI={(instance) => {
            api.current = instance;
          }}
          initialData={mode === "recall" ? { elements: [], scrollToContent: true } : initialData(load.board)}
          onChange={onChange}
          viewModeEnabled={mode === "board" && save.state === "conflict" ? true : undefined}
          theme={theme}
          name={title}
          aiEnabled={false}
          UIOptions={{
            canvasActions: {
              loadScene: false,
              saveToActiveFile: false,
              export: false,
              saveAsImage: false,
              toggleTheme: false,
              clearCanvas: mode === "board",
            },
          }}
        >
          <MainMenu>
            <MainMenu.DefaultItems.SearchMenu />
            <MainMenu.DefaultItems.Help />
            {mode === "board" ? <MainMenu.DefaultItems.ClearCanvas /> : null}
            <MainMenu.Separator />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
          </MainMenu>
        </Excalidraw>
      ) : (
        <div className="flex h-full items-center justify-center px-4">
          {load.state === "loading" ? (
            <Spinner />
          ) : (
            <div className="flex max-w-[44ch] flex-col items-center gap-3 text-center">
              <p className="text-title text-paper">The board couldn’t be opened.</p>
              <p className="text-label text-dim">{load.error}</p>
              <Button onClick={open}>Try again</Button>
            </div>
          )}
        </div>
      )}
      {mode === "board" && save.state === "conflict" ? (
        <div role="alert" className="absolute inset-x-3 top-3 z-10 flex items-center gap-3 rounded-lg bg-panel-raised px-3 py-2.5 shadow-float ring-1 ring-inset ring-line">
          <p className="min-w-0 flex-1 text-label text-prose">
            This board changed in another app while it was open, so it stopped saving over it and can’t be edited here until you open the file’s version. Yours is saved beside it as “{save.copy.split("/").pop()}”.
          </p>
          <Button size="sm" onClick={open}>
            Open the file’s version
          </Button>
        </div>
      ) : null}
      {stuck && save.state === "failed" ? (
        <div role="alert" className="absolute inset-x-3 top-3 z-10 flex flex-wrap items-center gap-2 rounded-lg bg-panel-raised px-3 py-2.5 shadow-float ring-1 ring-inset ring-line">
          <p className="min-w-0 flex-1 text-label text-prose">The board couldn’t be saved, so it stayed open with your drawing. {save.error}</p>
          <Button size="sm" variant="ghost" onClick={() => (stuck === "recall" ? setStuck(null) : leave(stuck, true))}>
            {stuck === "recall" ? "Not now" : "Leave without saving"}
          </Button>
          <Button size="sm" variant="primary" onClick={() => (stuck === "recall" ? void startRecall() : leave(stuck))}>
            Try again
          </Button>
        </div>
      ) : null}
      {mode === "board" && (pending.length || notice || error) ? (
        <SuggestionBar pending={pending} notice={notice} error={error} onDecide={decide} onShow={show} />
      ) : null}
    </div>
  );

  return (
    <div aria-label={`Whiteboard: ${title}`} role="region" className="flex min-h-0 flex-1 flex-col">
      <PaneHeader>
        <IconButton size="sm" label="All boards" onClick={() => back()}>
          <ChevronLeft />
        </IconButton>
        <span title={path ?? undefined} className="min-w-0 truncate text-label font-medium text-paper">
          {mode === "recall" ? `Draw it back · ${board?.chapter ?? title}` : title}
        </span>
        {mode === "board" && saveLine ? (
          <span className={save.state === "failed" || save.state === "conflict" ? "shrink-0 text-caption text-danger" : "shrink-0 text-caption text-dim"}>{saveLine}</span>
        ) : null}
        <span className="flex-1" />
        {mode === "recall" ? (
          <>
            <span title={askBlocked ?? undefined} className="inline-flex">
              <Button size="sm" variant="primary" disabled={!!askBlocked || !!busy} onClick={() => void ask("check")}>
                {busy === "check" ? <Spinner /> : <Check />}
                Check my links
              </Button>
            </span>
            <Button size="sm" onClick={endRecall}>
              Back to my board
            </Button>
          </>
        ) : chapterBoard ? (
          <>
            <span title={askBlocked ?? `Read the board against “${board?.chapter}”`} className="inline-flex">
              <Button size="sm" variant="ghost" disabled={!!askBlocked || !!busy || load.state !== "ready"} onClick={() => void ask("review")}>
                {busy === "review" ? <Spinner /> : <Eye />}
                Review
              </Button>
            </span>
            {board?.kind === "chapter" ? (
              <Button size="sm" variant="ghost" title="Close the book and redraw the chapter from memory" disabled={load.state !== "ready"} onClick={() => void startRecall()}>
                <RotateCcw />
                Draw it back
              </Button>
            ) : null}
            <Divider />
          </>
        ) : null}
        {bookShown ? (
          <IconButton size="sm" label={side === "right" ? "Move the board to the left of the book" : "Move the board to the right of the book"} disabled={mode === "recall"} onClick={onSwap}>
            <ArrowLeftRight />
          </IconButton>
        ) : null}
        <IconButton size="sm" label={bookShown ? "Hide the book" : "Show the book"} active={!bookShown} disabled={mode === "recall"} onClick={onToggleBook}>
          {/* The book is on the far side of the board: the icon's panel is the book. */}
          {side === "right" ? bookShown ? <PanelLeftClose /> : <PanelLeftOpen /> : bookShown ? <PanelRightClose /> : <PanelRightOpen />}
        </IconButton>
        <IconButton size="sm" label="Close the whiteboard" onClick={() => close()}>
          <X />
        </IconButton>
      </PaneHeader>
      <div className="flex min-h-0 flex-1">
        {canvas}
        {railShown ? (
          <aside aria-label="Tutor" className="flex w-[272px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line px-3.5 py-3.5">
            {mode === "recall" ? (
              <RecallRail check={check} busy={busy === "check"} onShow={(link) => check && show(check.ids[link])} />
            ) : busy === "review" ? (
              <p className="flex items-center gap-2 text-label text-dim">
                <Spinner /> The tutor is reading the board against the chapter…
              </p>
            ) : review ? (
              <ReviewRail
                review={review.review}
                onShow={(link) => show(review.ids[link])}
                onDone={() => setReview(null)}
                onAnswer={() => onAnswer(`You asked about my board: ${review.review.question}\n\n`)}
              />
            ) : null}
            {mode === "recall" && error ? <p className="text-label text-danger">{error}</p> : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The tutor's suggestions waiting on the board, at its foot: kept or dropped all at once, or one by one from the
 * list it opens. Also where a change that no longer fit, or a failed request, is said.
 */
function SuggestionBar({
  pending,
  notice,
  error,
  onDecide,
  onShow,
}: {
  pending: Suggestion[];
  notice: string | null;
  error: string | null;
  onDecide(id: string | null, accept: boolean): void;
  onShow(id: string): void;
}) {
  const [listed, setListed] = useState(false);
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-14 z-10 flex justify-center">
      <div className="pointer-events-auto flex w-full max-w-[400px] flex-col overflow-hidden rounded-xl bg-panel-raised shadow-float ring-1 ring-inset ring-line">
        {listed && pending.length ? (
          <ul className="flex max-h-56 flex-col overflow-y-auto border-b border-line p-1">
            {pending.map((suggestion) => (
              <li key={suggestion.id} className="flex items-center gap-1 rounded-md py-0.5 pl-2 pr-0.5 hover:bg-tint">
                <button type="button" onClick={() => onShow(suggestion.elementId)} className="press min-w-0 flex-1 truncate py-1 text-left text-label text-prose">
                  {suggestion.label}
                </button>
                <IconButton size="sm" label="Drop this suggestion" onClick={() => onDecide(suggestion.id, false)}>
                  <X />
                </IconButton>
                <IconButton size="sm" label="Keep this suggestion" onClick={() => onDecide(suggestion.id, true)}>
                  <Check />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : null}
        {notice || error ? <p className={error ? "px-3 pt-2 text-label text-danger" : "px-3 pt-2 text-label text-dim"}>{error ?? notice}</p> : null}
        {pending.length ? (
          <div className="flex items-center gap-1 py-1.5 pl-2 pr-1.5">
            <button
              type="button"
              aria-expanded={listed}
              onClick={() => setListed(!listed)}
              className="press flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-label text-paper hover:text-paper"
            >
              <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: SUGGESTION_COLOR }} />
              <span className="truncate">
                {pending.length} {pending.length === 1 ? "suggestion" : "suggestions"}
              </span>
              <ChevronDown aria-hidden className={listed ? "size-3.5 shrink-0 rotate-180 text-dim transition-transform" : "size-3.5 shrink-0 text-dim transition-transform"} />
            </button>
            <Button size="sm" variant="ghost" onClick={() => onDecide(null, false)}>
              Drop all
            </Button>
            <Button size="sm" variant="primary" onClick={() => onDecide(null, true)}>
              Keep all
            </Button>
          </div>
        ) : (
          <span className="pb-2" />
        )}
      </div>
    </div>
  );
}

function ReviewRail({ review, onShow, onDone, onAnswer }: { review: BoardReview; onShow(link: string): void; onDone(): void; onAnswer(): void }) {
  return (
    <section className="animate-rise flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-label font-medium text-paper">The tutor’s review</h3>
        <IconButton size="sm" label="Done with the review" onClick={onDone}>
          <X />
        </IconButton>
      </div>
      {review.missing.length ? (
        <div className="flex flex-col gap-1">
          <p className="text-label text-fog">Left out</p>
          <ul className="flex flex-col gap-0.5 pl-3 text-label text-prose">
            {review.missing.map((idea) => (
              <li key={idea} className="list-disc">
                {idea}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-label text-fog">Nothing central is left out.</p>
      )}
      {review.wrongLinks.length ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-label text-fog">Links to look at again</p>
          {review.wrongLinks.map((wrong) => (
            <button
              key={wrong.link}
              type="button"
              onClick={() => onShow(wrong.link)}
              className="press rounded-md bg-tint px-2.5 py-1.5 text-left text-label text-prose hover:bg-tint-strong"
            >
              {wrong.why}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <p className="text-body font-medium leading-snug text-paper">{review.question}</p>
        <Button size="sm" className="self-start" onClick={onAnswer}>
          Answer in the chat
        </Button>
      </div>
    </section>
  );
}

function RecallRail({ check, busy, onShow }: { check: { check: BoardCheck } | null; busy: boolean; onShow(link: string): void }) {
  if (busy) {
    return (
      <p className="flex items-center gap-2 text-label text-dim">
        <Spinner /> The tutor is checking your links against the chapter…
      </p>
    );
  }
  if (!check) {
    return (
      <p className="text-label leading-relaxed text-dim">
        The book is closed. Draw the chapter from memory: its ideas, and arrows for how they lead to each other. The tutor then points at the first link that
        doesn’t hold. There’s no score.
      </p>
    );
  }
  const { wrong, note } = check.check;
  return (
    <section className="animate-rise flex flex-col gap-2">
      {wrong ? (
        <>
          <p className="text-body font-medium text-paper">Look again at this link.</p>
          <button
            type="button"
            onClick={() => onShow(wrong.link)}
            className="press rounded-md bg-tint px-2.5 py-1.5 text-left text-label text-prose hover:bg-tint-strong"
          >
            {wrong.hint}
          </button>
        </>
      ) : (
        <p className="text-body font-medium text-paper">Every link holds.</p>
      )}
      <p className="text-label text-dim">{note}</p>
    </section>
  );
}
