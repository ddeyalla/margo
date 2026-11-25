"use client";

import "@excalidraw/excalidraw/index.css";
import { CaptureUpdateAction, Excalidraw, exportToBlob, hashElementsVersion, MainMenu, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Eye, RotateCcw, Send, X } from "lucide-react";
import { Button, IconButton, Spinner } from "@/components/ui";
import { compactScene, type BoardCheck, type BoardReview, type OpenedBoard } from "@/lib/shared/boards";
import type { BookId, ProviderId } from "@/lib/shared/types";
import { askBoard, fetchBoard, putBoard, type BoardRequest } from "./api";
import { mermaidElements } from "./mermaid";
import { acceptSuggestion, pendingSuggestions, readerElements, rejectSuggestion, suggestionsFor, type Suggestion } from "./suggestions";

/* Excalidraw fetches its fonts from a CDN unless told where they are; the app serves its own copies, offline. */
if (typeof window !== "undefined") (window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = "/vendor/excalidraw/";

export interface WhiteboardProps {
  bookId: BookId;
  chapter: string;
  labels: string[];
  provider: ProviderId | null;
  /** Why the tutor can't be asked right now, or null. */
  unavailable: string | null;
  theme: "light" | "dark";
  /** A Mermaid diagram from the chat to add to the board once it's open. */
  mermaid: string | null;
  onMermaidUsed(): void;
  /** Draw it back closes the book: the tutor panel folds away while it lasts. */
  onRecall(active: boolean): void;
  /** Sends a message to the tutor's chat. */
  onAnswer(text: string): void;
  onClose(): void;
}

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; board: OpenedBoard; key: number };
type Save = { state: "saved" | "saving" | "unsaved" } | { state: "failed"; error: string } | { state: "conflict"; copy: string };
type Busy = "review" | "check" | "edit" | null;

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

const pendingKey = (list: readonly Suggestion[]) => list.map((s) => s.id).join(",");

/**
 * A chapter's whiteboard over the book. The reader draws; the board saves itself to the notes folder as they go.
 * The tutor can review it against the chapter, or change it when asked, and what it sends back arrives as
 * suggestions the reader takes or leaves one at a time. "Draw it back" swaps in a blank board with the book
 * closed: redrawn from memory, the tutor points at the first link that doesn't hold, and says nothing more.
 */
export default function Whiteboard(props: WhiteboardProps) {
  const { bookId, chapter, labels, provider, unavailable, theme, mermaid, onMermaidUsed, onRecall, onAnswer, onClose } = props;
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
  const [instruction, setInstruction] = useState("");
  const [answer, setAnswer] = useState("");

  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const hash = useRef<string | null>(null);
  /* The version of the reader's elements last saved or opened; null until the board first reports. */
  const savedVersion = useRef<number | null>(null);
  /** The drawing whose save just failed: it waits for the next edit rather than retrying on every pointer move. */
  const failedVersion = useRef<number | null>(null);
  /**
   * The board as it last reported itself, which is what a save writes. Never read back from the canvas: by the time a
   * closing board saves, Excalidraw has already emptied its scene.
   */
  const latest = useRef<{
    elements: readonly ExcalidrawElement[];
    appState: AppState;
    files: BinaryFiles;
  } | null>(null);
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
  /* The load whose scene Excalidraw has put on the canvas: it applies the file a moment after mounting. */
  const [shown, setShown] = useState<number | null>(null);

  /* Only the latest opening lands: an earlier one answering late would put the canvas back as it was. */
  const opening = useRef(0);
  const fetchInto = useCallback(() => {
    const ticket = ++opening.current;
    return fetchBoard(bookId, chapter).then(
      (board) => {
        if (ticket !== opening.current) return;
        hash.current = board.file?.hash ?? null;
        savedVersion.current = null;
        latest.current = null;
        conflicted.current = false;
        setPath(board.file ? board.path : null);
        setSave({ state: "saved" });
        setLoad((current) => ({
          state: "ready",
          board,
          key: (current.state === "ready" ? current.key : 0) + 1,
        }));
      },
      (failure: unknown) => {
        if (ticket === opening.current)
          setLoad({
            state: "failed",
            error: failure instanceof Error ? failure.message : "The board couldn't be opened.",
          });
      },
    );
  }, [bookId, chapter]);

  useEffect(() => {
    void fetchInto();
  }, [fetchInto]);

  /** Opens the board again from its file. */
  const open = () => {
    setLoad({ state: "loading" });
    void fetchInto();
  };

  /** Saves the reader's drawing if it changed since the last save. One save at a time; after a conflict, none. */
  const flush = useCallback(
    async (keepalive = false): Promise<void> => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (inFlight.current) await inFlight.current;
      const board = latest.current;
      if (!board || conflicted.current || modeRef.current !== "board") return;
      const elements = readerElements(board.elements.filter((element) => !element.isDeleted));
      const version = hashElementsVersion(elements);
      if (version === savedVersion.current) return;
      const text = serializeAsJSON(elements, board.appState, board.files, "local");
      setSave({ state: "saving" });
      const run = putBoard(bookId, { chapter, labels, text, baseHash: hash.current }, keepalive).then(
        (result) => {
          if (result.state === "saved") {
            hash.current = result.hash;
            savedVersion.current = version;
            setPath(result.path);
            setSave({ state: "saved" });
          } else {
            conflicted.current = true;
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
    },
    [bookId, chapter, labels],
  );

  const onChange = (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
    const list = pendingSuggestions(elements);
    setPending((current) => (pendingKey(current) === pendingKey(list) ? current : list));
    if (mode !== "board" || conflicted.current) return;
    latest.current = { elements, appState, files };
    const version = hashElementsVersion(readerElements(elements.filter((element) => !element.isDeleted)));
    if (savedVersion.current === null) {
      savedVersion.current = version;
      if (load.state === "ready") setShown(load.key);
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
      void flush(true);
    };
  }, [flush]);

  /* A diagram from the chat lands on the board once the board's own drawing is on it, as the reader's own drawing. */
  useEffect(() => {
    if (!mermaid || load.state !== "ready" || shown !== load.key || mode !== "board") return;
    const board = api.current;
    if (!board) return;
    onMermaidUsed();
    mermaidElements(mermaid, board.getSceneElements()).then(
      ({ elements, files }) => {
        if (files.length) board.addFiles(files);
        board.updateScene({
          elements: [...board.getSceneElementsIncludingDeleted(), ...elements],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        board.scrollToContent(elements, { fitToContent: true, animate: true });
      },
      (failure: unknown) => setError(`The diagram couldn't be turned into a board. ${failure instanceof Error ? failure.message : ""}`.trim()),
    );
  }, [mermaid, load, shown, mode, onMermaidUsed]);

  const ask = async (kind: "review" | "check" | "edit") => {
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
      chapter,
      labels,
      provider,
      scene,
      image: await picture(board),
    };
    const body: BoardRequest = kind === "edit" ? { op: "edit", ...base, instruction: instruction.trim() } : { op: kind, ...base };
    try {
      const reply = await askBoard(bookId, body, aborter.current.signal);
      if (reply.kind === "check") {
        setCheck({ check: reply.check, ids });
        const wrong = reply.check.wrong && ids[reply.check.wrong.link];
        if (wrong) show(wrong);
        return;
      }
      const ops = reply.kind === "review" ? reply.review.ops : reply.ops;
      if (reply.kind === "review") {
        setReview({ review: reply.review, ids });
        setAnswer("");
      } else setInstruction("");
      const { added, dropped } = suggestionsFor(ops, ids, board.getSceneElementsIncludingDeleted());
      if (added.length)
        board.updateScene({
          elements: [...board.getSceneElementsIncludingDeleted(), ...added],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      if (dropped)
        setNotice(
          `${dropped} suggestion${dropped === 1 ? " was" : "s were"} left out: ${dropped === 1 ? "it was" : "they were"} about something you changed meanwhile.`,
        );
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

  const startRecall = async () => {
    await flush();
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

  const close = async () => {
    if (mode === "recall") onRecall(false);
    await flush();
    onClose();
  };

  const saveLine =
    save.state === "saving"
      ? "Saving…"
      : save.state === "unsaved"
        ? "Edited"
        : save.state === "failed"
          ? save.error
          : save.state === "conflict"
            ? "Not saved"
            : path
              ? "Saved to your notes"
              : "";
  const askBlocked = !provider ? (unavailable ?? "No tutor is available.") : null;

  return (
    <div role="dialog" aria-modal aria-label={`Whiteboard: ${chapter}`} className="animate-fade absolute inset-0 z-30 flex flex-col bg-page">
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <span className="min-w-0 truncate text-label text-fog">
          {mode === "recall" ? "Draw it back" : "Whiteboard"} · {chapter}
        </span>
        {mode === "board" && saveLine ? (
          <span
            title={path ?? undefined}
            className={save.state === "failed" || save.state === "conflict" ? "shrink-0 text-label text-danger" : "shrink-0 text-label text-dim"}
          >
            {saveLine}
          </span>
        ) : null}
        <span className="flex-1" />
        {mode === "board" ? (
          <>
            <span title={askBlocked ?? undefined} className="inline-flex">
              <Button size="sm" disabled={!!askBlocked || !!busy || load.state !== "ready"} onClick={() => void ask("review")}>
                {busy === "review" ? <Spinner /> : <Eye />}
                Review with the tutor
              </Button>
            </span>
            <Button size="sm" disabled={!!busy || load.state !== "ready"} onClick={() => void startRecall()}>
              <RotateCcw />
              Draw it back
            </Button>
          </>
        ) : (
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
        )}
        <IconButton label="Close the whiteboard" onClick={() => void close()}>
          <X />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="board-canvas relative min-w-0 flex-1">
          {load.state === "ready" ? (
            <Excalidraw
              key={`${mode}:${load.key}`}
              excalidrawAPI={(instance) => {
                api.current = instance;
              }}
              initialData={mode === "recall" ? { elements: [], scrollToContent: true } : initialData(load.board)}
              onChange={onChange}
              theme={theme}
              name={chapter}
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
            <div className="flex h-full items-center justify-center">
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
        </div>
        <aside aria-label="Tutor" className="flex w-[300px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line px-4 py-4">
          {mode === "recall" ? (
            <RecallRail check={check} busy={busy === "check"} onShow={(link) => check && show(check.ids[link])} />
          ) : (
            <>
              {save.state === "conflict" ? (
                <div className="flex flex-col gap-2 rounded-lg bg-tint px-3 py-2.5">
                  <p className="text-label text-paper">This board changed in another app while it was open, so the app stopped saving over it.</p>
                  <p className="text-label text-dim">Your version is saved beside it as “{save.copy.split("/").pop()}”.</p>
                  <Button size="sm" className="self-start" onClick={open}>
                    Open the file’s version
                  </Button>
                </div>
              ) : null}
              {!review && !pending.length && !busy ? (
                <p className="text-label leading-relaxed text-dim">
                  Draw the chapter’s ideas in boxes and join them with arrows for how they connect. The tutor can review the board against the chapter; anything
                  it adds shows up in its own colour for you to keep or drop.
                </p>
              ) : null}
              {busy === "review" || busy === "edit" ? (
                <p className="flex items-center gap-2 text-label text-dim">
                  <Spinner /> The tutor is reading the board…
                </p>
              ) : null}
              {review ? (
                <ReviewRail
                  review={review.review}
                  answer={answer}
                  onAnswer={setAnswer}
                  onShow={(link) => show(review.ids[link])}
                  onSend={() => {
                    onAnswer(`On my whiteboard of “${chapter}”, you asked: ${review.review.question}\n\nMy answer: ${answer.trim()}`);
                    setAnswer("");
                  }}
                />
              ) : null}
              {pending.length ? (
                <section className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-label font-medium text-paper">Suggestions</h3>
                    <span className="flex-1" />
                    <button type="button" className="press text-label text-dim hover:text-paper" onClick={() => decide(null, false)}>
                      Drop all
                    </button>
                    <button type="button" className="press text-label text-dim hover:text-paper" onClick={() => decide(null, true)}>
                      Keep all
                    </button>
                  </div>
                  <ul className="flex flex-col gap-1">
                    {pending.map((suggestion) => (
                      <li key={suggestion.id} className="flex items-center gap-1 rounded-md bg-tint py-1 pl-2.5 pr-1">
                        <span className="min-w-0 flex-1 text-label text-prose">{suggestion.label}</span>
                        <IconButton size="sm" label="Drop this suggestion" onClick={() => decide(suggestion.id, false)}>
                          <X />
                        </IconButton>
                        <IconButton size="sm" label="Keep this suggestion" onClick={() => decide(suggestion.id, true)}>
                          <Check />
                        </IconButton>
                      </li>
                    ))}
                  </ul>
                  <p className="text-caption text-dim">Suggestions are saved only once you keep them.</p>
                </section>
              ) : null}
              <span className="flex-1" />
              <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (instruction.trim()) void ask("edit");
                }}
              >
                <label htmlFor="board-ask" className="text-label text-fog">
                  Ask the tutor to change the board
                </label>
                <div className="flex items-end gap-1.5">
                  <textarea
                    id="board-ask"
                    rows={2}
                    value={instruction}
                    onChange={(event) => setInstruction(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    placeholder="Add what the chapter says causes this"
                    className="min-w-0 flex-1 resize-none rounded-md bg-panel px-2.5 py-1.5 text-label text-paper shadow-chip outline-none placeholder:text-dim focus-visible:ring-1 focus-visible:ring-line-strong"
                  />
                  <span title={askBlocked ?? undefined} className="inline-flex">
                    <IconButton label="Send to the tutor" type="submit" disabled={!instruction.trim() || !!askBlocked || !!busy}>
                      {busy === "edit" ? <Spinner /> : <Send />}
                    </IconButton>
                  </span>
                </div>
              </form>
            </>
          )}
          {notice ? <p className="text-label text-dim">{notice}</p> : null}
          {error ? <p className="text-label text-danger">{error}</p> : null}
        </aside>
      </div>
    </div>
  );
}

function ReviewRail({
  review,
  answer,
  onAnswer,
  onShow,
  onSend,
}: {
  review: BoardReview;
  answer: string;
  onAnswer(text: string): void;
  onShow(link: string): void;
  onSend(): void;
}) {
  return (
    <section className="animate-rise flex flex-col gap-3">
      <h3 className="text-label font-medium text-paper">The tutor’s review</h3>
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
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (answer.trim()) onSend();
        }}
      >
        <p className="text-body font-medium leading-snug text-paper">{review.question}</p>
        <textarea
          rows={3}
          value={answer}
          onChange={(event) => onAnswer(event.target.value)}
          placeholder="Your answer, in your own words"
          className="resize-none rounded-md bg-panel px-2.5 py-1.5 text-label text-paper shadow-chip outline-none placeholder:text-dim focus-visible:ring-1 focus-visible:ring-line-strong"
        />
        <Button size="sm" type="submit" className="self-start" disabled={!answer.trim()}>
          Answer in the chat
        </Button>
      </form>
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
