import { ACTIVITY_KINDS, MAX_REPORT_SECONDS, reportSeconds } from "@/lib/shared/mastery";
import type { LibraryBook, PassageThread } from "@/lib/shared/types";
import { recordActivity } from "../activity";
import { parkThread, saveParked } from "../parked";
import { ToolError } from "./schema";
import { BOOK_ID, defineTool, requireBook } from "./tool";

/* The two tools that change the reader's data directly. Neither touches what the reader wrote or the book's
   content: one leaves a question for them to ask later, the other adds time to the activity log. */

/** What an agent is told a passage looks like. The app's own parser does the checking. */
export const ANCHOR_SHAPE = {
  description: 'Where the passage is, copied from a search hit or a block of get_book_text: { "kind": "epub", "cfi": "epubcfi(…)" } or { "kind": "pdf", "page": 3, "start": 0, "end": 120 }.',
  type: "object",
};

/**
 * Parks a question on a passage of `book`: saved with the book, not sent to the tutor. `body` is
 * `{ question, selection: { text, anchor, chapterTitle?, before?, after? }, provider? }`, checked here for the
 * route and the tool alike.
 */
export const parkQuestion = async (book: LibraryBook, body: Record<string, unknown>): Promise<PassageThread> => {
  const thread = parkThread(body, book);
  if (typeof thread === "string") throw new ToolError(thread);
  await saveParked(book.id, thread);
  return thread;
};

const parkQuestionTool = defineTool({
  name: "park_question",
  description: "Leaves a question on a passage for the reader to ask the tutor later. It shows in the book's chat list as a parked question; nothing is sent to the tutor.",
  effect: "write",
  input: {
    bookId: BOOK_ID,
    question: { type: "string", max: 8_000, description: "The question, in the reader's voice." },
    selection: {
      type: "object",
      description: "The passage the question is about.",
      shape: {
        properties: {
          text: { type: "string", description: "The passage, word for word from the book." },
          anchor: ANCHOR_SHAPE,
          chapterTitle: { type: "string", description: "The chapter it is in." },
          before: { type: "string", description: "The text just before it, for context." },
          after: { type: "string", description: "The text just after it." },
        },
        required: ["text", "anchor"],
      },
    },
  },
  run: async ({ bookId, question, selection }) => {
    const thread = await parkQuestion((await requireBook(bookId)).book, { question, selection });
    return { threadId: thread.id, parkedAt: thread.parkedAt };
  },
});

/** Adds learning time to today's study day. Seconds are capped per report and per day, as the book page's own reports are. */
export const logActivity = defineTool({
  name: "log_activity",
  description: `Records time the reader spent learning a book outside the app, such as a study session run by an agent. It counts toward today's minutes and the streak. At most ${MAX_REPORT_SECONDS} seconds per call.`,
  effect: "write",
  input: {
    bookId: BOOK_ID,
    kind: { type: "string", max: 20, oneOf: ACTIVITY_KINDS, description: "What the time was spent on." },
    seconds: { type: "number", min: 0, max: 1_000_000_000, description: "How long, in seconds." },
  },
  run: async ({ bookId, kind, seconds }, { now }) => {
    const counted = reportSeconds(seconds);
    if (counted === null) throw new ToolError('"seconds" must be more than zero.');
    /* Only a book in the library gathers time, so an agent can't add minutes under an id that names nothing. */
    await recordActivity((await requireBook(bookId)).book.id, kind, counted, now);
    return { recorded: counted };
  },
});

export const WRITE_TOOLS = [parkQuestionTool, logActivity] as const;
