import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  isBoardFile,
  parseCheckReply,
  BOARD_OPS_GUIDE,
  parseReviewReply,
  type BoardAnswer,
  type BoardAttempt,
  chapterBoardId,
  type Board,
  type BoardSave,
  type BoardSummary,
  type CompactScene,
  type OpenedBoard,
} from "@/lib/shared/boards";
import type { BookId } from "@/lib/shared/types";
import { conflictName, contentHash, createUnique, NotesPathError, readVersioned, resolveInside, saveIfUnchanged } from "./notes-folder";
import { chapterBlocks, fitBlocks } from "./quiz/generate";
import { bookText } from "./search/index";
import { readBookState, serialized, updateBookState } from "./store";
import type { BookLabel } from "./tutor/prompt";
import type { Provider, TutorImage, TutorMessage } from "./tutor/types";
import { safeFileName } from "./vault";

/* Whiteboards in the notes folder: "Whiteboards/<Book>/<Title>.excalidraw", a plain Excalidraw file Obsidian's
   Excalidraw plugin opens. Like the reader's notes, a board another app changed is never overwritten: the save goes
   to a conflict copy beside it. The book's state lists its boards, and which file is which. */

export const BOARD_FOLDER = "Whiteboards";
const EXTENSION = ".excalidraw";

/** Where a board's first file is saved, relative to the notes folder. A taken name gets " 1", " 2"… */
export const boardPath = (bookTitle: string, title: string): string =>
  `${BOARD_FOLDER}/${safeFileName(bookTitle, "Untitled book")}/${safeFileName(title, "Untitled board")}${EXTENSION}`;

/** A board that can't be saved as sent. */
export class BoardError extends NotesPathError {}

/** No board by that id. */
export class NoSuchBoard extends Error {}

const boardFile = (notesDir: string, rel: string) => resolveInside(notesDir, rel, [EXTENSION]);

const relativeTo = async (notesDir: string, file: string) => path.relative(await realpath(notesDir), file).split(path.sep).join("/");

const findBoard = (boards: readonly Board[], id: string) => boards.find((board) => board.id === id);

const getBoard = async (bookId: BookId, id: string): Promise<Board> => {
  const board = findBoard((await readBookState(bookId)).boards, id);
  if (!board) throw new NoSuchBoard("That board isn't in this book any more.");
  return board;
};

/** The book's boards with one of them changed. Throws `NoSuchBoard` when it was removed meanwhile, as the change is made. */
const changeBoard = (bookId: BookId, id: string, change: (board: Board) => Board) =>
  updateBookState(bookId, (state) => {
    const board = findBoard(state.boards, id);
    if (!board) throw new NoSuchBoard("That board isn't in this book any more.");
    return { ...state, boards: state.boards.map((entry) => (entry.id === id ? change(board) : entry)) };
  });

/** Writes a new board file under a name nothing else holds, and returns its path relative to the notes folder. */
const createFile = async (notesDir: string, rel: string, text: string) => {
  const { file } = await boardFile(notesDir, rel);
  return relativeTo(notesDir, await createUnique(path.dirname(file), path.basename(file, EXTENSION), EXTENSION, text));
};

/* Boards are added one at a time per book, so two quick clicks on one diagram make one board. */
const adding = (bookId: BookId, task: () => Promise<Board>) => serialized(`boards\n${bookId}`, task);

/** The book's boards, newest file first, each with when its file last changed. */
export const listBoards = async (notesDir: string | null, bookId: BookId): Promise<BoardSummary[]> => {
  const { boards } = await readBookState(bookId);
  const edited = await Promise.all(
    boards.map(async (board) => {
      if (!notesDir || !board.path) return null;
      try {
        const { file } = await boardFile(notesDir, board.path);
        return (await stat(file)).mtime.toISOString();
      } catch {
        return null;
      }
    }),
  );
  return boards.map((board, i) => ({ ...board, editedAt: edited[i] })).sort((a, b) => (b.editedAt ?? "").localeCompare(a.editedAt ?? ""));
};

export const openBoard = async (notesDir: string, bookId: BookId, id: string): Promise<OpenedBoard> => {
  const board = await getBoard(bookId, id);
  if (!board.path) return { board, file: null };
  const { file } = await boardFile(notesDir, board.path);
  return { board, file: await readVersioned(file) };
};

/** A chapter's board, added to the book's list the first time it's asked for. Its file is made on its first save. */
export const chapterBoard = (bookId: BookId, chapter: string, labels: string[], occurrence = 0): Promise<Board> =>
  adding(bookId, async () => {
    const id = chapterBoardId(chapter, occurrence);
    const state = await updateBookState(bookId, (current) => {
      const existing = findBoard(current.boards, id);
      if (existing) {
        const same = existing.labels.length === labels.length && existing.labels.every((label, i) => label === labels[i]);
        return same ? current : { ...current, boards: current.boards.map((b) => (b.id === id ? { ...b, labels } : b)) };
      }
      return { ...current, boards: [...current.boards, { id, title: chapter, kind: "chapter", chapter, labels, path: null, attempts: [] }] };
    });
    return findBoard(state.boards, id)!;
  });

/**
 * Adds a board of the reader's own, with its file. One made from a chat diagram carries the diagram's hash in
 * `from`: asked again for the same diagram, the board it made before comes back instead of a second one.
 */
export const createBoard = (
  notesDir: string,
  { bookId, bookTitle }: { bookId: BookId; bookTitle: string },
  { title, chapter, labels, text, from }: { title: string; chapter: string | null; labels: string[]; text: string; from: string | null },
): Promise<Board> =>
  adding(bookId, async () => {
    if (!isBoardFile(text)) throw new BoardError("That isn't an Excalidraw board, or it's too big to save.");
    if (from) {
      const made = (await readBookState(bookId)).boards.find((board) => board.from === from);
      if (made) return made;
    }
    const rel = await createFile(notesDir, boardPath(bookTitle, title), text);
    const board: Board = { id: randomUUID(), title, kind: "free", chapter, labels, path: rel, attempts: [], ...(from ? { from } : {}) };
    await updateBookState(bookId, (state) => ({ ...state, boards: [...state.boards, board] }));
    return board;
  });

/** Renames a board in the app. Its file keeps the name it was saved under, as a renamed chapter's board does. */
export const renameBoard = async (bookId: BookId, id: string, title: string): Promise<Board> => {
  const state = await changeBoard(bookId, id, (board) => ({ ...board, title }));
  return findBoard(state.boards, id)!;
};

/**
 * Takes a board off the book's list. Its file stays in the notes folder: it is the reader's drawing. A chapter's own
 * board stays, as its draw-it-back attempts are what retention reads.
 */
export const removeBoard = async (bookId: BookId, id: string): Promise<void> => {
  if ((await getBoard(bookId, id)).kind === "chapter") throw new BoardError("A chapter's own board stays: its draw-it-back history counts toward the Course.");
  await updateBookState(bookId, (state) => ({ ...state, boards: state.boards.filter((board) => board.id !== id) }));
};

/** Keeps `text` beside `file` as a conflict copy, leaving the file as it is. */
/** A board's file is saved as a note is: over the file only while it is still the version opened. */
export const replaceIfUnchanged = saveIfUnchanged;

/**
 * Saves a board. `baseHash` is the version it was opened at, or null for a board with no file yet, which is
 * created under a name nothing else holds. Saves of one board queue behind each other, and each reads the board's
 * entry inside the queue: a save from null that finds a file another save already made keeps both, as a stale save does.
 */
export const saveBoard = (
  notesDir: string,
  { bookId, bookTitle }: { bookId: BookId; bookTitle: string },
  { id, text, baseHash }: { id: string; text: string; baseHash: string | null },
): Promise<BoardSave> =>
  serialized(`board\n${bookId}\n${id}`, async () => {
    if (!isBoardFile(text)) throw new BoardError("That isn't an Excalidraw board, or it's too big to save.");
    const board = await getBoard(bookId, id);
    if (baseHash === null) {
      if (board.path) {
        const { file } = await boardFile(notesDir, board.path);
        const current = await readVersioned(file);
        if (current?.text === text) return { state: "saved", path: board.path, hash: current.hash };
        if (current) {
          /* Another save made the file first: keep it, and this drawing beside it. */
          const ext = path.extname(file);
          const copy = await createUnique(path.dirname(file), conflictName(path.basename(file, ext), new Date()), ext, text);
          return { state: "conflict", path: board.path, copy: await relativeTo(notesDir, copy), current };
        }
      }
      /* No file yet, or the one it had was removed: a new one, under its old name when that is free. */
      const rel = await createFile(notesDir, board.path ?? boardPath(bookTitle, board.title), text);
      await changeBoard(bookId, id, (b) => ({ ...b, path: rel }));
      return { state: "saved", path: rel, hash: contentHash(text) };
    }
    if (!board.path) throw new BoardError("This board has no file yet; save it as new.");
    const { file } = await boardFile(notesDir, board.path);
    const result = await replaceIfUnchanged(file, text, baseHash);
    if (result.state === "saved") return { state: "saved", path: board.path, hash: result.hash };
    return { state: "conflict", path: board.path, copy: await relativeTo(notesDir, result.copy), current: result.current };
  });

/** Records a draw-it-back attempt on a chapter's board and returns its attempts. */
export const recordAttempt = async (bookId: BookId, id: string, attempt: BoardAttempt): Promise<BoardAttempt[]> => {
  const state = await changeBoard(bookId, id, (board) => ({ ...board, attempts: [...board.attempts, attempt].slice(-200) }));
  return findBoard(state.boards, id)?.attempts ?? [];
};

/* The tutor on the board. */

const BOARD_INTRO = `A reader is drawing a whiteboard of a chapter they are reading: the chapter's ideas as boxes or words, and arrows for how the ideas connect. You get the chapter's text in numbered blocks, the board as JSON (each node's text and position, each link's ends and label), and a picture of it.`;

export const REVIEW_SYSTEM = `${BOARD_INTRO}

Look over the board against the chapter, as a tutor would:
- "missing": the chapter's central ideas the board leaves out, each in a few words. Only what matters to the chapter's argument, at most eight. Empty if nothing important is missing.
- "wrong_links": links that say something the chapter doesn't support, by link id, each with why in one sentence that points back to the chapter. Leave out links that are only worded loosely.
- "question": one question about a link on the board that makes the reader explain it: "Why does A lead to B?", with A and B in the board's own words.
- "ops": the missing ideas as new nodes linked where they belong, and a fix for each wrong link. Place new nodes near what they connect to.

${BOARD_OPS_GUIDE}

Reply with exactly one JSON object and nothing else:
{"missing": ["..."], "wrong_links": [{"link": "l2", "why": "..."}], "question": "...", "ops": [...]}`;

export const CHECK_SYSTEM = `${BOARD_INTRO}

This time the reader closed the book and redrew the chapter from memory. Check the links in the order the chapter makes its argument, and stop at the first one the chapter does not support: the wrong direction, the wrong cause, or two ideas joined that the chapter keeps apart. Missing ideas are not wrong links.
- "wrong": that first wrong link's id and a "hint" that sends the reader back to the right part of the chapter without giving the answer. null when every link holds.
- "note": one sentence to the reader. No score, no grade, no list of everything else.

Reply with exactly one JSON object and nothing else:
{"wrong": {"link": "l3", "hint": "..."}, "note": "..."}`;

export type BoardAsk = { kind: "review" } | { kind: "check" };

const SYSTEMS = { review: REVIEW_SYSTEM, check: CHECK_SYSTEM } as const;

export const boardRequest = (book: BookLabel, chapter: string, blocks: readonly { text: string }[], scene: CompactScene, ask: BoardAsk): string =>
  [
    `Book: ${book.title}${book.author ? `, by ${book.author}` : ""}`,
    `Chapter: ${chapter}`,
    "",
    "<chapter>",
    ...blocks.map((block, i) => `[${i + 1}] ${block.text}`),
    "</chapter>",
    "",
    "<board>",
    JSON.stringify(scene),
    "</board>",
    "",
    ask.kind === "review" ? "Review this board." : "Check this board, drawn from memory.",
  ].join("\n");

const parse = (ask: BoardAsk, reply: string, scene: CompactScene): BoardAnswer | string => {
  if (ask.kind === "review") {
    const review = parseReviewReply(reply, scene);
    return typeof review === "string" ? review : { kind: "review", review };
  }
  const check = parseCheckReply(reply, scene);
  return typeof check === "string" ? check : { kind: "check", check };
};

/**
 * One request to the tutor about a chapter's board, answered as JSON the app checks against the board. A reply
 * that can't be used goes back once with the reason, as a quiz does.
 */
export const askAboutBoard = async (
  provider: Provider,
  { bookId, book, chapter, labels, scene, image, ask }: { bookId: BookId; book: BookLabel; chapter: string; labels: readonly string[]; scene: CompactScene; image: TutorImage | null; ask: BoardAsk },
  model: string | null,
  signal: AbortSignal,
): Promise<BoardAnswer> => {
  const text = await bookText(bookId, { extract: true });
  if (!text) throw new Error("The book's text couldn't be read.");
  const blocks = fitBlocks(chapterBlocks(text, labels.length ? labels : [chapter]));
  if (!blocks.length) throw new Error(`“${chapter}” has no text the tutor can check the board against.`);

  const collect = async (messages: TutorMessage[]) => {
    let reply = "";
    for await (const event of provider.run({ system: SYSTEMS[ask.kind], messages, sessionId: null, model }, signal)) {
      if (event.type === "text") reply += event.delta;
      else if (event.type === "error") throw new Error(event.message);
    }
    return reply;
  };
  const messages: TutorMessage[] = [{ role: "user", content: boardRequest(book, chapter, blocks, scene, ask), images: image ? [image] : [] }];
  const first = await collect(messages);
  const answer = parse(ask, first, scene);
  if (typeof answer !== "string") return answer;
  const second = await collect([
    ...messages,
    { role: "assistant", content: first, images: [] },
    { role: "user", content: `That reply couldn't be used. ${answer} Reply again with exactly one JSON object in the format you were given.`, images: [] },
  ]);
  const repaired = parse(ask, second, scene);
  if (typeof repaired === "string") throw new Error(`The tutor's answer couldn't be read. ${repaired}`);
  return repaired;
};
