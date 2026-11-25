import { realpath } from "node:fs/promises";
import path from "node:path";
import {
  isBoardFile,
  parseCheckReply,
  parseEditReply,
  parseReviewReply,
  type BoardAnswer,
  type BoardAttempt,
  type BoardSave,
  type ChapterBoard,
  type CompactScene,
  type OpenedBoard,
} from "@/lib/shared/boards";
import type { BookId } from "@/lib/shared/types";
import { contentHash, createUnique, NotesPathError, readVersioned, resolveInside, saveIfUnchanged } from "./notes-folder";
import { chapterBlocks, fitBlocks } from "./quiz/generate";
import { bookText } from "./search/index";
import { readBookState, serialized, updateBookState } from "./store";
import type { BookLabel } from "./tutor/prompt";
import type { Provider, TutorImage, TutorMessage } from "./tutor/types";
import { safeFileName } from "./vault";

/* Chapter whiteboards in the notes folder: "Whiteboards/<Book>/<Chapter>.excalidraw", a plain Excalidraw file
   Obsidian's Excalidraw plugin opens. Like the reader's notes, a board another app changed is never overwritten:
   the save goes to a conflict copy beside it. The book's state remembers which file is which chapter's. */

export const BOARD_FOLDER = "Whiteboards";
const EXTENSION = ".excalidraw";

/** Where a chapter's first board is saved, relative to the notes folder. A taken name gets " 1", " 2"… */
export const boardPath = (bookTitle: string, chapter: string): string =>
  `${BOARD_FOLDER}/${safeFileName(bookTitle, "Untitled book")}/${safeFileName(chapter, "Untitled section")}${EXTENSION}`;

/** A board that can't be saved as sent. */
export class BoardError extends NotesPathError {}

const boardFile = (notesDir: string, rel: string) => resolveInside(notesDir, rel, [EXTENSION]);

const relativeTo = async (notesDir: string, file: string) => path.relative(await realpath(notesDir), file).split(path.sep).join("/");

const findBoard = (boards: readonly ChapterBoard[], chapter: string) => boards.find((board) => board.chapter === chapter);

/** The book's boards with this chapter's changed, adding it the first time. */
const withBoard = (boards: readonly ChapterBoard[], chapter: string, change: (board: ChapterBoard) => ChapterBoard): ChapterBoard[] => {
  const current = findBoard(boards, chapter) ?? { chapter, labels: [chapter], path: null, attempts: [] };
  return [...boards.filter((board) => board.chapter !== chapter), change(current)];
};

export const openBoard = async (notesDir: string, bookId: BookId, chapter: string): Promise<OpenedBoard> => {
  const board = findBoard((await readBookState(bookId)).boards, chapter);
  if (!board?.path) return { path: null, file: null, attempts: board?.attempts ?? [] };
  const { file } = await boardFile(notesDir, board.path);
  return { path: board.path, file: await readVersioned(file), attempts: board.attempts };
};

/**
 * Saves a chapter's board. `baseHash` is the version it was opened at, or null for a board with no file yet,
 * which is created under a name nothing else holds. Saves of one chapter's board queue behind each other.
 */
export const saveBoard = (
  notesDir: string,
  { bookId, bookTitle }: { bookId: BookId; bookTitle: string },
  { chapter, labels, text, baseHash }: { chapter: string; labels: string[]; text: string; baseHash: string | null },
): Promise<BoardSave> =>
  serialized(`board\n${bookId}\n${chapter}`, async () => {
    if (!isBoardFile(text)) throw new BoardError("That isn't an Excalidraw board, or it's too big to save.");
    const board = findBoard((await readBookState(bookId)).boards, chapter);
    if (baseHash === null) {
      const { file } = await boardFile(notesDir, board?.path ?? boardPath(bookTitle, chapter));
      const created = await createUnique(path.dirname(file), path.basename(file, EXTENSION), EXTENSION, text);
      const rel = await relativeTo(notesDir, created);
      await updateBookState(bookId, (state) => ({ ...state, boards: withBoard(state.boards, chapter, (b) => ({ ...b, labels, path: rel })) }));
      return { state: "saved", path: rel, hash: contentHash(text) };
    }
    if (!board?.path) throw new BoardError("This board has no file yet; save it as new.");
    const { file } = await boardFile(notesDir, board.path);
    const result = await saveIfUnchanged(file, text, baseHash);
    if (result.state === "saved") return { state: "saved", path: board.path, hash: result.hash };
    return { state: "conflict", path: board.path, copy: await relativeTo(notesDir, result.copy), current: result.current };
  });

/** Records a draw-it-back attempt on the chapter's board and returns its attempts. */
export const recordAttempt = async (bookId: BookId, chapter: string, labels: string[], attempt: BoardAttempt): Promise<BoardAttempt[]> => {
  const state = await updateBookState(bookId, (current) => ({
    ...current,
    boards: withBoard(current.boards, chapter, (board) => ({ ...board, labels, attempts: [...board.attempts, attempt].slice(-200) })),
  }));
  return findBoard(state.boards, chapter)?.attempts ?? [];
};

/* The tutor on the board. */

const OPS_GUIDE = `Ops change the board. The reader sees each one as a suggestion in its own colour and accepts or rejects it; nothing you send replaces their drawing.
- {"op": "add_node", "id": "habit-loop", "text": "Habit loop", "x": 420, "y": 160} adds an idea. The id is a short lowercase name of your own. Leave out x and y to let the app place it.
- {"op": "add_link", "from": "n2", "to": "habit-loop", "label": "builds"} adds an arrow between two nodes on the board or added above. The label is optional.
- {"op": "update", "id": "n3", "text": "..."} rewords a node, or a link's label.
- {"op": "delete", "id": "l2"} removes a node or link.
Nodes on the board are n1, n2…; links are l1, l2…, as the board JSON lists them.`;

const BOARD_INTRO = `A reader is drawing a whiteboard of a chapter they are reading: the chapter's ideas as boxes or words, and arrows for how the ideas connect. You get the chapter's text in numbered blocks, the board as JSON (each node's text and position, each link's ends and label), and a picture of it.`;

export const REVIEW_SYSTEM = `${BOARD_INTRO}

Look over the board against the chapter, as a tutor would:
- "missing": the chapter's central ideas the board leaves out, each in a few words. Only what matters to the chapter's argument, at most eight. Empty if nothing important is missing.
- "wrong_links": links that say something the chapter doesn't support, by link id, each with why in one sentence that points back to the chapter. Leave out links that are only worded loosely.
- "question": one question about a link on the board that makes the reader explain it: "Why does A lead to B?", with A and B in the board's own words.
- "ops": the missing ideas as new nodes linked where they belong, and a fix for each wrong link. Place new nodes near what they connect to.

${OPS_GUIDE}

Reply with exactly one JSON object and nothing else:
{"missing": ["..."], "wrong_links": [{"link": "l2", "why": "..."}], "question": "...", "ops": [...]}`;

export const CHECK_SYSTEM = `${BOARD_INTRO}

This time the reader closed the book and redrew the chapter from memory. Check the links in the order the chapter makes its argument, and stop at the first one the chapter does not support: the wrong direction, the wrong cause, or two ideas joined that the chapter keeps apart. Missing ideas are not wrong links.
- "wrong": that first wrong link's id and a "hint" that sends the reader back to the right part of the chapter without giving the answer. null when every link holds.
- "note": one sentence to the reader. No score, no grade, no list of everything else.

Reply with exactly one JSON object and nothing else:
{"wrong": {"link": "l3", "hint": "..."}, "note": "..."}`;

export const EDIT_SYSTEM = `${BOARD_INTRO}

The reader asks you to change the board. Make the change they ask for, and only that, as ops that stay true to the chapter.

${OPS_GUIDE}

Reply with exactly one JSON object and nothing else:
{"ops": [...]}`;

export type BoardAsk = { kind: "review" } | { kind: "check" } | { kind: "edit"; instruction: string };

const SYSTEMS = { review: REVIEW_SYSTEM, check: CHECK_SYSTEM, edit: EDIT_SYSTEM } as const;

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
    ask.kind === "review"
      ? "Review this board."
      : ask.kind === "check"
        ? "Check this board, drawn from memory."
        : `The reader asks: ${ask.instruction}`,
  ].join("\n");

const parse = (ask: BoardAsk, reply: string, scene: CompactScene): BoardAnswer | string => {
  if (ask.kind === "review") {
    const review = parseReviewReply(reply, scene);
    return typeof review === "string" ? review : { kind: "review", review };
  }
  if (ask.kind === "check") {
    const check = parseCheckReply(reply, scene);
    return typeof check === "string" ? check : { kind: "check", check };
  }
  const ops = parseEditReply(reply, scene);
  return typeof ops === "string" ? ops : { kind: "edit", ops };
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
