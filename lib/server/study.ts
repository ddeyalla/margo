import { randomUUID } from "node:crypto";
import { placeLabel } from "@/lib/shared/place";
import {
  EXPLAIN_BACK_QUESTION,
  gradeNote,
  isStudy,
  MAX_ANSWER,
  offersYourTurn,
  openStudy,
  seenBefore,
  splitYourTurn,
  studyState,
  type LearnerTurn,
  type Overrule,
  type Study,
  type StudyThread,
} from "@/lib/shared/study";
import type { BookId, ChatMessage, LibraryBook, PassageThread, ProviderId, Thread } from "@/lib/shared/types";
import { gradeAnswer } from "./check/grade";
import type { Checker } from "./check/provider";
import { replyObject, textField } from "./check/reply";
import { getConfig } from "./config";
import { passageThread } from "./passage";
import { hold, readBookState, updateBookState } from "./store";
import { ACTION_MESSAGES, type BookLabel } from "./tutor/prompt";
import { structured } from "./tutor/structured";
import type { Provider } from "./tutor/types";
import { shortText } from "./validate";

/* Go deeper: the reader's turn on a passage. The tutor writes at most the question; a separate grader marks each
   answer, and both the answer and its grade are kept on the thread. */

/** Something the request got wrong, or a thread that is gone: the route answers 400 with the message. */
export class StudyError extends Error {}

const MAX_EXPECTED = 2_000;

export const QUESTION_SYSTEM = `You write one question for a reader to try before a passage of their book is explained to them. You get the passage and the text around it.

- Ask about the idea underneath the passage: why it holds, what it rests on, or what follows from it. The reader has just read the passage and answers from memory, in a sentence or two.
- One question in one sentence, asking for one thing. Don't quote the passage and don't give the answer away.
- "expected" is the answer the passage supports, in one or two sentences, using only what the passage says.

Reply with exactly one JSON object and nothing else:

{"question": "...", "expected": "..."}`;

export const parseQuestionReply = (text: string): { question: string; expected: string } | string => {
  const reply = replyObject(text);
  if (typeof reply === "string") return reply;
  const question = textField(reply.question, 500);
  const expected = textField(reply.expected, MAX_EXPECTED);
  return question && expected ? { question, expected } : 'The reply needs a "question" and an "expected" answer, each a short piece of text.';
};

export const questionRequest = (book: BookLabel, thread: PassageThread): string => {
  const where = placeLabel(thread.chapterTitle, thread.anchor);
  return [
    `Book: ${book.title}${book.author ? `, by ${book.author}` : ""}`,
    where ? `Where: ${where}` : null,
    "",
    `<before>\n${thread.before || "(start of the section)"}\n</before>`,
    "",
    `<passage>\n${thread.quote}\n</passage>`,
    "",
    `<after>\n${thread.after || "(end of the section)"}\n</after>`,
    "",
    "Write the question for the passage.",
  ]
    .filter((line) => line !== null)
    .join("\n");
};

/** Who writes the question for a passage the reader has not asked about yet. */
export interface QuestionWriter {
  provider: Provider;
  model: string | null;
  book: BookLabel;
  signal: AbortSignal;
}

const emptyStudy = (mode: Study["mode"], question: string, expected: string | null): Study => ({ mode, question, expected, rubric: null, draft: "", turns: [] });

/** The study a "Your turn" prompt opens: its question, on the passage the answer was about, with that answer as what a right one says. */
const studyFromAnswer = (threads: readonly Thread[], threadId: string, provider: ProviderId): StudyThread => {
  const source = threads.find((thread) => thread.id === threadId);
  const answer = source?.messages.findLast((message) => message.role === "assistant");
  const { body, prompt } = splitYourTurn(answer?.content ?? "");
  if (!source || !offersYourTurn(source) || !prompt) throw new StudyError("That answer has no question to try.");
  const now = new Date().toISOString();
  return {
    kind: "passage",
    id: randomUUID(),
    anchor: source.anchor,
    quote: source.quote,
    before: source.before,
    after: source.after,
    chapterTitle: source.chapterTitle,
    action: "deeper",
    provider,
    sessionId: null,
    createdAt: now,
    messages: [{ role: "user", content: ACTION_MESSAGES.deeper, createdAt: now }],
    study: emptyStudy("guess", prompt, body.trim().slice(0, MAX_EXPECTED) || null),
  };
};

/**
 * Opens the reader's turn on a passage and saves it as a thread. `body` is `{ selection }`, or `{ from }` naming the
 * thread whose answer closed with a "Your turn" prompt. A turn already open on the same passage is picked up as it
 * is. A passage the reader has asked about before gets an explain-back, with no model call; any other gets one
 * question, written here by the tutor.
 */
export const startStudy = async (
  book: LibraryBook,
  body: Record<string, unknown>,
  provider: ProviderId,
  writer: QuestionWriter,
  dataDir = getConfig().dataDir,
): Promise<StudyThread> => {
  const { threads } = await readBookState(book.id, dataDir);
  let thread: StudyThread;
  if (typeof body.from === "string") {
    thread = studyFromAnswer(threads, body.from, provider);
  } else {
    const base = passageThread({ ...body, action: "deeper", question: null }, book, provider);
    if (typeof base === "string" || base.kind !== "passage") throw new StudyError(typeof base === "string" ? base : "Invalid selection.");
    const open = openStudy(threads, base.quote);
    if (open) return open;
    if (seenBefore(threads, base.quote)) {
      thread = { ...base, study: emptyStudy("explainBack", EXPLAIN_BACK_QUESTION, null) };
    } else {
      const written = await structured(
        writer.provider,
        { system: QUESTION_SYSTEM, request: questionRequest(writer.book, base), parse: parseQuestionReply, failure: "The tutor's question couldn't be read." },
        writer.model,
        writer.signal,
      );
      thread = { ...base, study: emptyStudy("guess", written.question, written.expected) };
    }
  }
  const asked: ChatMessage = { role: "assistant", content: thread.study.question, createdAt: new Date().toISOString() };
  const saved: StudyThread = { ...thread, messages: [...thread.messages, asked] };
  await updateBookState(book.id, (state) => ({ ...state, threads: [...state.threads, saved] }), dataDir);
  return saved;
};

/** Changes one study thread in the saved state and gives it back. Throws when the thread is gone. */
const changeStudy = async (bookId: BookId, threadId: string, change: (thread: StudyThread) => StudyThread, dataDir: string): Promise<StudyThread> => {
  const state = await updateBookState(
    bookId,
    (current) => ({ ...current, threads: current.threads.map((thread) => (thread.id === threadId && isStudy(thread) ? change(thread) : thread)) }),
    dataDir,
  );
  const saved = state.threads.find((thread) => thread.id === threadId);
  if (!isStudy(saved)) throw new StudyError("This thread no longer exists.");
  return saved;
};

/**
 * Grades the reader's answer against the passage and keeps both: the answer and the grade's note join the thread,
 * and the outcome is added to the study's turns. Nothing is saved when the grader fails. The tutor's own session
 * never saw these messages, so it is dropped and the next tutor turn replays the thread. It waits its turn on the
 * thread like a tutor turn does, so a hint still streaming can't save its session over that.
 */
export const answerStudy = async (
  bookId: BookId,
  threadId: string,
  answer: unknown,
  checker: Checker,
  signal: AbortSignal,
  dataDir = getConfig().dataDir,
): Promise<StudyThread> => {
  const text = shortText(answer, MAX_ANSWER);
  if (!text) throw new StudyError("Write an answer first.");
  const release = await hold(`turn:${bookId}:${threadId}`);
  try {
    return await gradeAndSave(bookId, threadId, text, checker, signal, dataDir);
  } finally {
    release();
  }
};

const gradeAndSave = async (bookId: BookId, threadId: string, text: string, checker: Checker, signal: AbortSignal, dataDir: string): Promise<StudyThread> => {
  const thread = (await readBookState(bookId, dataDir)).threads.find((candidate) => candidate.id === threadId);
  if (!isStudy(thread)) throw new StudyError("This thread no longer exists.");
  const { question, expected, rubric } = thread.study;
  const grade = await gradeAnswer(
    checker.provider,
    { question, passage: thread.quote, answer: text, expected: expected ?? thread.quote, rubric: rubric ?? undefined },
    checker.model,
    signal,
  );
  const at = new Date().toISOString();
  return changeStudy(
    bookId,
    threadId,
    (current) => {
      const turn: LearnerTurn = {
        at,
        answer: text,
        verdict: grade.verdict,
        score: grade.score,
        unsure: grade.unsure,
        gap: grade.gap,
        hintsUsed: studyState(current).hintsUsed,
        override: null,
      };
      return {
        ...current,
        sessionId: null,
        messages: [...current.messages, { role: "user", content: text, createdAt: at }, { role: "assistant", content: gradeNote(turn), createdAt: at }],
        study: { ...current.study, rubric: grade.rubric, draft: "", turns: [...current.study.turns, turn] },
      };
    },
    dataDir,
  );
};

/** Keeps the answer the reader left unfinished, for when they come back. */
export const saveStudyDraft = (bookId: BookId, threadId: string, draft: unknown, dataDir = getConfig().dataDir): Promise<StudyThread> => {
  if (typeof draft !== "string" || draft.length > MAX_ANSWER) throw new StudyError("That draft is too long.");
  return changeStudy(bookId, threadId, (thread) => ({ ...thread, study: { ...thread.study, draft } }), dataDir);
};

/** Records the reader's own call on a graded answer, by the turn's time. Null takes it back. */
export const overruleStudy = (bookId: BookId, threadId: string, at: unknown, override: Overrule | null, dataDir = getConfig().dataDir): Promise<StudyThread> =>
  changeStudy(
    bookId,
    threadId,
    (thread) => ({ ...thread, study: { ...thread.study, turns: thread.study.turns.map((turn) => (turn.at === at ? { ...turn, override } : turn)) } }),
    dataDir,
  );
