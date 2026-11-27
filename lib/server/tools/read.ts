import { compactScene, isBoardId, type BoardElement } from "@/lib/shared/boards";
import { masteryLine } from "@/lib/shared/mastery";
import { isParked } from "@/lib/shared/parked";
import { typeOf } from "@/lib/shared/items";
import { hasDeferred, reviewQueue } from "@/lib/shared/schedule";
import type { Thread } from "@/lib/shared/types";
import { listBoards, NoSuchBoard, openBoard } from "../boards";
import { getFolders } from "../config";
import { masteryOf } from "../courses/progress";
import { readCourses } from "../courses/store";
import { readLibrary } from "../library";
import { bookText, searchLibrary } from "../search/index";
import { readSettings } from "../settings";
import { readBookState } from "../store";
import { readToday } from "../today";
import { ToolError } from "./schema";
import { BOOK_ID, clip, defineTool, requireBook, requireBookState, titleOf } from "./tool";

/* Tools that only read. Each one is the app's own reader for that data, with the answer cut to what an agent
   needs: ids to call other tools with, anchors to point at passages, and text short enough to read whole. */

const listLibrary = defineTool({
  name: "list_library",
  description: "Every book in the reader's library: id, title, author, how far they have read, and how much they saved for it.",
  effect: "read",
  input: {},
  run: async (_, { now }) => {
    const [{ books }, { dailyLoad }] = await Promise.all([readLibrary(), readSettings()]);
    return {
      books: await Promise.all(
        books.map(async (book) => {
          const state = await readBookState(book.id).catch(() => null);
          return {
            id: book.id,
            title: titleOf(state, book.fileTitle),
            author: state?.meta?.author ?? book.fileAuthor,
            format: book.format,
            folder: book.folder,
            /** From 0 to 1, or null for a book never opened. */
            progress: state?.position?.fraction ?? null,
            lastReadAt: state?.lastReadAt ?? null,
            highlights: state?.highlights.length ?? 0,
            notes: state?.notes.length ?? 0,
            cardSets: state?.cardSets.length ?? 0,
            cardsDue: state ? reviewQueue(state.cardSets, now, dailyLoad).length : 0,
            threads: state?.threads.length ?? 0,
            boards: state?.boards.length ?? 0,
          };
        }),
      ),
    };
  },
});

const DEFAULT_TEXT_CHARS = 12_000;

const getBookText = defineTool({
  name: "get_book_text",
  description:
    "A book's text in reading order, as numbered blocks with the anchor of each. With no arguments it starts at the beginning and lists the chapters. Give `chapter` to read one chapter, or `from` to continue from a block index (the `next` of the last answer). Reading a book for the first time can take a few seconds.",
  effect: "read",
  input: {
    bookId: BOOK_ID,
    chapter: { type: "string", max: 500, optional: true, description: "A chapter title from the `chapters` list. Matched exactly, then by the words it contains." },
    from: { type: "integer", min: 0, max: 10_000_000, optional: true, description: "The block index to start at." },
    maxChars: { type: "integer", min: 500, max: 40_000, optional: true, description: `About how much text to return. Default ${DEFAULT_TEXT_CHARS}.` },
  },
  run: async ({ bookId, chapter, from, maxChars = DEFAULT_TEXT_CHARS }) => {
    const { book, title } = await requireBookState(bookId);
    const text = await bookText(book.id, { extract: true });
    if (!text) throw new ToolError("That book's text can't be read.");
    const chapters = text.chapters.map((name) => ({ title: name, firstBlock: text.blocks.findIndex((block) => block.chapter === name), blocks: text.blocks.filter((block) => block.chapter === name).length }));

    let wanted: string | null = null;
    if (chapter) {
      const lower = chapter.toLowerCase();
      wanted = text.chapters.find((name) => name === chapter) ?? text.chapters.find((name) => name.toLowerCase().includes(lower)) ?? null;
      if (!wanted) throw new ToolError(`No chapter is called "${chapter}". Call get_book_text with only the bookId for the chapter list.`);
    }
    const start = from ?? (wanted ? chapters.find((entry) => entry.title === wanted)!.firstBlock : 0);
    const blocks: { index: number; chapter: string | null; anchor: unknown; text: string }[] = [];
    let chars = 0;
    let next: number | null = null;
    for (let index = start; index < text.blocks.length; index++) {
      const block = text.blocks[index];
      if (wanted && block.chapter !== wanted) continue;
      if (blocks.length && chars + block.text.length > maxChars) {
        next = index;
        break;
      }
      blocks.push({ index, chapter: block.chapter, anchor: block.anchor, text: block.text });
      chars += block.text.length;
    }
    return { book: { id: book.id, title }, ...(from === undefined && !wanted ? { chapters } : {}), blocks, next };
  },
});

/* A first search in a process that has no index yet waits this long for the books to be read, then answers with what it has. */
const INDEX_WAIT_MS = 45_000;
const DEFAULT_HITS = 20;

const searchLibraryTool = defineTool({
  name: "search_library",
  description:
    "Searches every book's text and the reader's highlights, notes and cards for the words given. Each hit has the book, chapter, an anchor and a snippet. `indexing` says how many books are searchable; the rest are still being read.",
  effect: "read",
  input: {
    query: { type: "string", max: 200, description: "The words to look for." },
    bookId: { ...BOOK_ID, optional: true, description: "Only hits in this book." },
    limit: { type: "integer", min: 1, max: 60, optional: true, description: `The most hits to return. Default ${DEFAULT_HITS}.` },
  },
  run: async ({ query, bookId, limit = DEFAULT_HITS }) => {
    if (bookId) await requireBook(bookId);
    let results = await searchLibrary(query);
    if (results.building && results.indexing.ready + results.indexing.failed < results.indexing.total) {
      await Promise.race([results.building, new Promise((resolve) => setTimeout(resolve, INDEX_WAIT_MS).unref())]);
      results = await searchLibrary(query);
    }
    const hits = results.books
      .filter((book) => !bookId || book.id === bookId)
      .flatMap((book) => book.chapters.flatMap((chapter) => chapter.hits.map((hit) => ({ bookId: book.id, book: book.title, chapter: chapter.title, kind: hit.kind, anchor: hit.anchor, snippet: hit.snippet }))));
    return { hits: hits.slice(0, limit), total: hits.length, indexing: results.indexing };
  },
});

const listAnnotations = defineTool({
  name: "list_annotations",
  description: "The reader's highlights and notes for a book, each with its passage, chapter and anchor. Notes are markdown.",
  effect: "read",
  input: { bookId: BOOK_ID },
  run: async ({ bookId }) => {
    const { book, state, title } = await requireBookState(bookId);
    return { book: { id: book.id, title }, highlights: state.highlights, notes: state.notes };
  },
});

const firstQuestion = (thread: Thread) => thread.messages.find((message) => message.role === "user")?.content ?? "";

const listThreads = defineTool({
  name: "list_threads",
  description: "The reader's past conversations with the tutor about a book, oldest first: what passage each is about, the first question, and whether it is a parked question not asked yet. Read one with get_thread.",
  effect: "read",
  input: { bookId: BOOK_ID },
  run: async ({ bookId }) => {
    const { book, state, title } = await requireBookState(bookId);
    return {
      book: { id: book.id, title },
      threads: state.threads.map((thread) => ({
        id: thread.id,
        kind: thread.kind,
        action: thread.kind === "passage" ? thread.action : null,
        chapter: thread.chapterTitle,
        quote: thread.kind === "passage" ? clip(thread.quote, 300) : null,
        question: clip(firstQuestion(thread), 300),
        parked: isParked(thread),
        messages: thread.messages.length,
        createdAt: thread.createdAt,
      })),
    };
  },
});

const getThread = defineTool({
  name: "get_thread",
  description: "One conversation with the tutor in full: the passage it is about and every message.",
  effect: "read",
  input: { bookId: BOOK_ID, threadId: { type: "string", max: 100, description: "The thread's id, from list_threads." } },
  run: async ({ bookId, threadId }) => {
    const { state } = await requireBookState(bookId);
    const thread = state.threads.find((entry) => entry.id === threadId);
    if (!thread) throw new ToolError("That book has no thread with that id. Call list_threads for the ids.");
    return {
      id: thread.id,
      kind: thread.kind,
      action: thread.kind === "passage" ? thread.action : null,
      chapter: thread.chapterTitle,
      anchor: thread.anchor,
      quote: thread.kind === "passage" ? thread.quote : null,
      parked: isParked(thread),
      createdAt: thread.createdAt,
      messages: thread.messages.map(({ role, content, createdAt }) => ({ role, content, createdAt })),
    };
  },
});

const MAX_QUEUE = 50;

const reviewQueueTool = defineTool({
  name: "review_queue",
  description: `The bank's items ready now, in the order the app would show them, held to the reader's daily limit: for each passage, the fact, its items (each a question and answer with its type: "flip" to recall and rate, "choice" with its options, or "free" for a written answer a grader marks), the passage and where its schedule stands. Review cards and chapter-quiz questions are the same items. One book, or every book. At most ${MAX_QUEUE} are listed; \`due\` is how many the limit lets through today. \`moreWaiting\` says only that the limit held some back; it is not a backlog to work through.`,
  effect: "read",
  input: { bookId: { ...BOOK_ID, optional: true, description: "Only this book's items." } },
  run: async ({ bookId }, { now }) => {
    const [books, { dailyLoad }] = await Promise.all([bookId ? requireBook(bookId).then(({ book }) => [book]) : readLibrary().then((library) => library.books), readSettings()]);
    const queues = await Promise.all(
      books.map(async (book) => {
        const state = await readBookState(book.id).catch(() => null);
        return {
          moreWaiting: !!state && hasDeferred(state.cardSets, now, dailyLoad),
          cards: (state ? reviewQueue(state.cardSets, now, dailyLoad) : []).map((set) => ({
            bookId: book.id,
            book: titleOf(state, book.fileTitle),
            setId: set.id,
            chapter: set.chapterTitle,
            fact: set.fact,
            quote: clip(set.quote, 400),
            cards: set.cues.map((cue) => ({ question: cue.question, answer: cue.answer, type: typeOf(cue), ...(cue.choices ? { choices: cue.choices } : {}) })),
            state: set.schedule.state,
            dueAt: set.schedule.due,
          })),
        };
      }),
    );
    const due = queues.flatMap((queue) => queue.cards);
    return { due: due.length, moreWaiting: queues.some((queue) => queue.moreWaiting), cards: due.slice(0, MAX_QUEUE) };
  },
});

const getToday = defineTool({
  name: "get_today",
  description: "What the app's Today card shows: cards due, the next course quiz, the book being read and minutes left in it, today's minutes against the daily minimum, and the streak.",
  effect: "read",
  input: {},
  run: (_, { now }) => readToday(now),
});

const listCourses = defineTool({
  name: "list_courses",
  description: "The reader's Courses: each one's goal, books and units of chapters in order, with a line on how much is covered and retained.",
  effect: "read",
  input: {},
  run: async (_, { now }) => {
    const { courses } = await readCourses();
    return { courses: await Promise.all(courses.map(async (course) => ({ ...course, mastery: masteryLine(await masteryOf(course, now)) }))) };
  },
});

const listBoardsTool = defineTool({
  name: "list_boards",
  description: "A book's whiteboards: id, title, the chapter each is about, and when its file last changed. Read one with read_board.",
  effect: "read",
  input: { bookId: BOOK_ID },
  run: async ({ bookId }) => {
    const { book } = await requireBook(bookId);
    return { boards: await listBoards(getFolders().notes.path, book.id) };
  },
});

const readBoard = defineTool({
  name: "read_board",
  description: "One whiteboard as the reader drew it: its ideas as nodes and the arrows between them as links. Suggestions they haven't accepted are left out.",
  effect: "read",
  input: { bookId: BOOK_ID, boardId: { type: "string", max: 64, description: "The board's id, from list_boards." } },
  run: async ({ bookId, boardId }) => {
    const { book } = await requireBook(bookId);
    if (!isBoardId(boardId)) throw new ToolError("That is not a board id. Call list_boards for the ids.");
    const notesDir = getFolders().notes.path;
    if (!notesDir) throw new ToolError("The reader has no notes folder set, and boards are saved there.");
    try {
      const { board, file } = await openBoard(notesDir, book.id, boardId);
      const elements = file ? ((JSON.parse(file.text) as { elements?: BoardElement[] }).elements ?? []) : [];
      return { board, scene: compactScene(elements).scene };
    } catch (error) {
      if (error instanceof NoSuchBoard) throw new ToolError("That book has no board with that id. Call list_boards for the ids.");
      throw error;
    }
  },
});

export const READ_TOOLS = [listLibrary, getBookText, searchLibraryTool, listAnnotations, listThreads, getThread, reviewQueueTool, getToday, listCourses, listBoardsTool, readBoard] as const;
