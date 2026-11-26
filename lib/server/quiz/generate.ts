import { randomUUID } from "node:crypto";
import { MAX_QUESTIONS, MIN_CHECKED_QUESTIONS, MIN_QUESTIONS, parseQuizReply, type ChapterQuiz, type QuizDraft } from "@/lib/shared/quiz";
import type { Anchor, BookId } from "@/lib/shared/types";
import { checked, CHECKS_AT_ONCE, isVerified } from "../check/verify";
import type { BookLabel } from "../tutor/prompt";
import { pooled, structured } from "../tutor/structured";
import type { Provider } from "../tutor/types";
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

/**
 * The most questions asked for again after a check drops some. With `MAX_QUESTIONS` it caps the checking a quiz
 * can cost: 12 questions, two calls each, a call repeated at most once when its reply can't be read.
 */
export const MAX_REPLACEMENTS = 4;

type Draft = QuizDraft[number];

export const replacementRequest = (
  book: BookLabel,
  chapter: string,
  blocks: readonly { text: string }[],
  kept: readonly Draft[],
  dropped: readonly { question: string; reason: string }[],
  count: number,
): string =>
  [
    quizRequest(book, chapter, blocks).replace(/\nWrite the quiz for this chapter\.$/, ""),
    "The quiz already has these questions. Don't ask them again:",
    ...kept.map((q) => `- ${q.question}`),
    "",
    "These were written for it and dropped, because someone answering from the cited block alone didn't arrive at the stored answer, or the block didn't back it:",
    ...dropped.map((q) => `- ${q.question} (${q.reason})`),
    "",
    `Write ${count} more question${count === 1 ? "" : "s"} for the quiz, on points of the chapter the kept questions don't cover, by the same rules and in the same format. Make sure the block you cite holds the whole answer.`,
  ].join("\n");

/** About how much text a question is checked against. */
const MAX_PASSAGE = 8_000;

/**
 * The text a question is checked against: the block it cites, with the block before and after when they fit,
 * since an explanation often runs over a paragraph break.
 */
export const questionPassage = (blocks: readonly { text: string }[], block: number): string => {
  const cited = blocks[block - 1].text;
  const around = blocks.slice(Math.max(0, block - 2), block + 1).map((b) => b.text).join("\n\n");
  return around.length <= MAX_PASSAGE ? around : cited;
};

/** The model that writes the quiz, and the one that checks it. */
export interface QuizModels {
  model: string | null;
  checkModel: string | null;
}

/**
 * Writes a chapter's questions and keeps only those that pass the check against the text they cite. Dropped
 * questions are asked for again once; what passes of those is added. Fewer than `MIN_CHECKED_QUESTIONS` left is
 * an error, never a quiz padded with unchecked questions.
 */
export const checkedQuestions = async (
  provider: Provider,
  { book, chapter, blocks }: { book: BookLabel; chapter: string; blocks: readonly { text: string }[] },
  { model, checkModel }: QuizModels,
  signal: AbortSignal,
): Promise<Draft[]> => {
  const failure = "The tutor's quiz couldn't be read.";
  const check = async (draft: readonly Draft[]) => {
    const results = await pooled(draft, CHECKS_AT_ONCE, (q) =>
      checked(provider, { question: q.question, expected: q.answer, passage: questionPassage(blocks, q.block) }, checkModel, signal),
    );
    return {
      kept: draft.filter((_, i) => isVerified(results[i])),
      dropped: draft.flatMap((q, i) => (isVerified(results[i]) ? [] : [{ question: q.question, reason: results[i].reason }])),
    };
  };

  const draft = await structured(
    provider,
    { system: QUIZ_SYSTEM, request: quizRequest(book, chapter, blocks), parse: (reply) => parseQuizReply(reply, blocks.length), failure },
    model,
    signal,
  );
  const first = await check(draft);
  const kept = first.kept;
  let dropped = first.dropped;
  if (dropped.length) {
    const count = Math.min(dropped.length, MAX_REPLACEMENTS);
    /* A second batch that can't be read leaves the quiz with what already passed. */
    const more = await structured(
      provider,
      { system: QUIZ_SYSTEM, request: replacementRequest(book, chapter, blocks, kept, dropped, count), parse: (reply) => parseQuizReply(reply, blocks.length, count), failure },
      model,
      signal,
    ).catch((error: unknown) => {
      if (signal.aborted) throw error;
      return [] as Draft[];
    });
    const asked = new Set([...draft, ...kept].map((q) => q.question.toLowerCase()));
    const second = await check(more.filter((q) => !asked.has(q.question.toLowerCase())));
    kept.push(...second.kept);
    dropped = [...dropped, ...second.dropped];
  }
  /* One line per quiz in the server's log: how much the check cost in questions, and why each one went. */
  console.info(`Quiz check for “${chapter}”: kept ${kept.length}, dropped ${dropped.length}.${dropped.map((q) => `\n  dropped: ${q.question} (${q.reason})`).join("")}`);
  if (kept.length < MIN_CHECKED_QUESTIONS) {
    throw new Error(
      `Only ${kept.length} of the ${kept.length + dropped.length} questions written for “${chapter}” held up when checked against the chapter's text, so no quiz was saved. ${dropped[0]?.reason ?? ""}`.trim(),
    );
  }
  return kept.slice(0, MAX_QUESTIONS);
};

/**
 * Writes a chapter's quiz in one batch, checked question by question before anything is saved. The anchor of each
 * question is the real start of the block the tutor cited, never one the tutor wrote.
 */
export const writeQuiz = async (
  provider: Provider,
  { bookId, book, chapter, labels }: { bookId: BookId; book: BookLabel; chapter: string; labels: readonly string[] },
  models: QuizModels,
  signal: AbortSignal,
): Promise<ChapterQuiz> => {
  const text = await bookText(bookId, { extract: true });
  if (!text) throw new Error("The book's text couldn't be read.");
  const blocks: { text: string; anchor: Anchor }[] = fitBlocks(chapterBlocks(text, labels.length ? labels : [chapter]));
  if (blocks.reduce((sum, block) => sum + block.text.length, 0) < 400) throw new Error(`“${chapter}” has too little text to write a quiz on.`);

  const questions = await checkedQuestions(provider, { book, chapter, blocks }, models, signal);
  const verifiedAt = new Date().toISOString();
  return {
    chapter,
    labels: [...new Set([chapter, ...labels])],
    questions: questions.map((q) => {
      const block = blocks[q.block - 1];
      return { id: randomUUID(), kind: q.kind, question: q.question, answer: q.answer, anchor: block.anchor, quote: block.text.slice(0, 600), verifiedAt };
    }),
    createdAt: verifiedAt,
    attempts: [],
  };
};
