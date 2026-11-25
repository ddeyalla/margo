import { randomUUID } from "node:crypto";
import { MAX_QUESTIONS, MIN_QUESTIONS, parseQuizReply, type ChapterQuiz } from "@/lib/shared/quiz";
import type { BookId } from "@/lib/shared/types";
import type { BookLabel } from "../tutor/prompt";
import type { Provider, TutorMessage } from "../tutor/types";
import { bookText, type BookText } from "../search/index";

export const QUIZ_SYSTEM = `You write the end-of-chapter quiz for someone reading a book as part of a course they set themselves. They have just finished the chapter. You get the chapter's text in numbered blocks.

Write ${MIN_QUESTIONS} to ${MAX_QUESTIONS} questions that check the chapter's main ideas stuck:
- Most are "recall": a definition, a claim, a distinction, a step, a number with what it measures.
- At least two are "why": the reader explains a reason, a cause, or how something works, in their own words.
- Cover the chapter from start to end, its central ideas first. Skip anecdotes, names in examples and trivia.
- Each question stands on its own for someone who read the chapter but isn't looking at it. Name the subject; never write "the passage", "the author" or "this chapter".
- No yes-or-no questions, and no question that gives its answer away.
- The answer is short: the point first, in one to three sentences, all of it supported by the text. The reader grades themselves against it, so make it clear what a right answer must contain.
- "block" is the number of the block the answer rests on most.

Reply with exactly one JSON object and nothing else:

{"questions": [{"kind": "recall", "question": "...", "answer": "...", "block": 12}, {"kind": "why", "question": "...", "answer": "...", "block": 30}]}`;

/** About how much chapter text goes to the tutor. A longer chapter keeps evenly spaced blocks up to this. */
const MAX_CHARS = 60_000;

/** The chapter's blocks, in order: those labelled with the chapter or anything nested under it. */
export const chapterBlocks = (text: BookText, labels: readonly string[]) => {
  const wanted = new Set(labels);
  return text.blocks.filter((block) => block.chapter !== null && wanted.has(block.chapter));
};

/** Thins a long chapter evenly so the tutor still sees all of it, start to end. */
export const fitBlocks = <T extends { text: string }>(blocks: readonly T[], max = MAX_CHARS): T[] => {
  const total = blocks.reduce((sum, block) => sum + block.text.length, 0);
  if (total <= max) return [...blocks];
  const keep = max / total;
  let budget = 0;
  return blocks.filter(() => {
    budget += keep;
    if (budget < 1) return false;
    budget -= 1;
    return true;
  });
};

export const quizRequest = (book: BookLabel, chapter: string, blocks: readonly { text: string }[]): string =>
  [
    `Book: ${book.title}${book.author ? `, by ${book.author}` : ""}`,
    `Chapter: ${chapter}`,
    "",
    "<chapter>",
    ...blocks.map((block, i) => `[${i + 1}] ${block.text}`),
    "</chapter>",
    "",
    "Write the quiz for this chapter.",
  ].join("\n");

const collect = async (provider: Provider, messages: TutorMessage[], model: string | null, signal: AbortSignal): Promise<string> => {
  let text = "";
  for await (const event of provider.run({ system: QUIZ_SYSTEM, messages, sessionId: null, model }, signal)) {
    if (event.type === "text") text += event.delta;
    else if (event.type === "error") throw new Error(event.message);
  }
  return text;
};

/**
 * Writes a chapter's quiz in one batch. The anchor of each question is the real start of the block the tutor
 * cited, never one the tutor wrote. A reply that can't be read goes back once with the reason.
 */
export const writeQuiz = async (
  provider: Provider,
  { bookId, book, chapter, labels }: { bookId: BookId; book: BookLabel; chapter: string; labels: readonly string[] },
  model: string | null,
  signal: AbortSignal,
): Promise<ChapterQuiz> => {
  const text = await bookText(bookId, { extract: true });
  if (!text) throw new Error("The book's text couldn't be read.");
  const blocks = fitBlocks(chapterBlocks(text, labels.length ? labels : [chapter]));
  if (blocks.reduce((sum, block) => sum + block.text.length, 0) < 400) throw new Error(`“${chapter}” has too little text to write a quiz on.`);

  const messages: TutorMessage[] = [{ role: "user", content: quizRequest(book, chapter, blocks), images: [] }];
  const first = await collect(provider, messages, model, signal);
  let draft = parseQuizReply(first, blocks.length);
  if (typeof draft === "string") {
    const repair: TutorMessage[] = [
      ...messages,
      { role: "assistant", content: first, images: [] },
      { role: "user", content: `That reply couldn't be used. ${draft} Reply again with exactly one JSON object in the format you were given.`, images: [] },
    ];
    draft = parseQuizReply(await collect(provider, repair, model, signal), blocks.length);
    if (typeof draft === "string") throw new Error(`The tutor's quiz couldn't be read. ${draft}`);
  }
  return {
    chapter,
    questions: draft.map((q) => {
      const block = blocks[q.block - 1];
      return { id: randomUUID(), kind: q.kind, question: q.question, answer: q.answer, anchor: block.anchor, quote: block.text.slice(0, 600) };
    }),
    createdAt: new Date().toISOString(),
    attempts: [],
  };
};
