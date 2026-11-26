import { firstObject } from "./json";
import type { CourseStep } from "./courses";
import type { Anchor, BookId, Stance } from "./types";

/** "recall" asks for something the chapter says; "why" asks the reader to explain a reason or a mechanism. */
export type QuestionKind = "recall" | "why";

export interface QuizQuestion {
  id: string;
  kind: QuestionKind;
  question: string;
  answer: string;
  /** Where in the chapter the answer is: the start of the block the tutor cited, and that block's text. */
  anchor: Anchor;
  quote: string;
  /** When the question was checked against the chapter's text and passed. Absent on quizzes saved before checking. */
  verifiedAt?: string;
}

/** One answer in an attempt. The reader marks it right or wrong themselves after seeing the answer. */
export interface QuizAnswer extends Stance {
  questionId: string;
  correct: boolean;
}

export interface QuizAttempt {
  at: string;
  answers: QuizAnswer[];
  passed: boolean;
}

/** A chapter's quiz, written once in one batch when the chapter is finished, and every attempt at it. */
export interface ChapterQuiz {
  /** The chapter's label in the book's table of contents. */
  chapter: string;
  /** The labels of the chapter and every entry nested under it, as the reader's contents had them. Absent on quizzes saved before it was kept. */
  labels?: string[];
  questions: QuizQuestion[];
  createdAt: string;
  attempts: QuizAttempt[];
}

export const MIN_QUESTIONS = 5;
/** The fewest questions a quiz is saved with, when some of what the tutor wrote didn't pass the check against the text. */
export const MIN_CHECKED_QUESTIONS = 3;
export const MAX_QUESTIONS = 8;

/** Share of questions to get right to pass: 4 of 5, 5 of 6, 6 of 7, 7 of 8. */
export const PASS_SHARE = 0.8;

export const passMark = (questions: number) => Math.ceil(questions * PASS_SHARE - 1e-9);

export const isPassed = (quiz: ChapterQuiz | undefined): boolean => !!quiz?.attempts.some((attempt) => attempt.passed);

/** Builds an attempt from the reader's answers, keeping only answers to questions the quiz has, once each. */
export const scoreAttempt = (quiz: ChapterQuiz, answers: readonly QuizAnswer[], at: Date): QuizAttempt => {
  const seen = new Set<string>();
  const kept = answers.filter((answer) => {
    if (seen.has(answer.questionId) || !quiz.questions.some((q) => q.id === answer.questionId)) return false;
    seen.add(answer.questionId);
    return true;
  });
  const right = kept.filter((answer) => answer.correct).length;
  return { at: at.toISOString(), answers: kept, passed: kept.length === quiz.questions.length && right >= passMark(quiz.questions.length) };
};

/** A chapter of a table of contents: its own entry and the entries nested under it, by index. */
export interface ChapterSpan {
  /** Index of the chapter's entry. */
  start: number;
  /** Index of the first entry after it that isn't nested in it, or the length of the list. */
  end: number;
  /** The labels of the chapter's entry and every entry nested under it. */
  labels: string[];
}

/** Where a chapter runs in a flattened table of contents, by its label. The first entry with that label wins. */
export const chapterSpan = (toc: readonly { label: string; depth: number }[], label: string): ChapterSpan | null => {
  const start = toc.findIndex((entry) => entry.label === label);
  if (start < 0) return null;
  let end = start + 1;
  while (end < toc.length && toc[end].depth > toc[start].depth) end++;
  return { start, end, labels: [...new Set(toc.slice(start, end).map((entry) => entry.label))] };
};

/** A chapter is finished once the reader is past every entry it holds. */
export const leftChapter = (span: ChapterSpan, currentIndex: number): boolean => currentIndex >= span.end;

/** The chapter whose span holds an entry, among the given chapter labels: the innermost one. */
export const chapterOf = (toc: readonly { label: string; depth: number }[], index: number, chapters: readonly string[]): string | null => {
  let found: { label: string; depth: number } | null = null;
  for (const label of chapters) {
    const span = chapterSpan(toc, label);
    if (span && index >= span.start && index < span.end && (!found || toc[span.start].depth > found.depth)) found = { label, depth: toc[span.start].depth };
  }
  return found?.label ?? null;
};

export interface StepState extends CourseStep {
  passed: boolean;
  /** Not reached in the Course yet: the step before it hasn't been passed. The book still opens; only the order says wait. */
  locked: boolean;
  /** The step before it, if any. */
  previous: CourseStep | null;
}

export const stepKey = (bookId: BookId | string, chapter: string) => `${bookId}\n${chapter}`;

/** Each step of a Course with whether it is passed and whether the step before it was. The first is never locked. */
export const stepStates = (steps: readonly CourseStep[], passed: ReadonlySet<string>): StepState[] =>
  steps.map((step, i) => {
    const previous = i ? steps[i - 1] : null;
    return {
      ...step,
      passed: passed.has(stepKey(step.bookId, step.chapter)),
      locked: !!previous && !passed.has(stepKey(previous.bookId, previous.chapter)),
      previous,
    };
  });

/** What the tutor wrote, checked: each question with the number of the block its answer rests on. */
export type QuizDraft = { kind: QuestionKind; question: string; answer: string; block: number }[];

const MAX_FIELD = 2_000;

const field = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_FIELD ? trimmed : null;
};

/**
 * Reads the quiz prompt's reply. Returns a message to send back for repair when it can't. A whole quiz needs
 * `MIN_QUESTIONS` and a "why" among them; `replacing` reads a reply asked for that many replacement questions.
 */
export const parseQuizReply = (text: string, blocks: number, replacing?: number): QuizDraft | string => {
  const json = firstObject(text);
  if (!json) return "The reply had no JSON object.";
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    return `The JSON did not parse: ${error instanceof Error ? error.message : "unknown error"}.`;
  }
  const questions = (value as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(questions)) return 'The reply needs a "questions" list.';
  const draft: QuizDraft = [];
  for (const item of questions) {
    const q = (item ?? {}) as Record<string, unknown>;
    const question = field(q.question);
    const answer = field(q.answer);
    const block = q.block;
    if (!question || !answer) return 'Every question needs a non-empty "question" and "answer".';
    if (q.kind !== "recall" && q.kind !== "why") return '"kind" must be "recall" or "why".';
    if (!Number.isInteger(block) || (block as number) < 1 || (block as number) > blocks) return `"block" must be a block number from 1 to ${blocks}.`;
    if (draft.some((d) => d.question.toLowerCase() === question.toLowerCase())) continue;
    draft.push({ kind: q.kind, question, answer, block: block as number });
  }
  if (replacing) return draft.length ? draft.slice(0, replacing) : `Write ${replacing} question${replacing === 1 ? "" : "s"}; the reply had none.`;
  if (draft.length < MIN_QUESTIONS) return `Write ${MIN_QUESTIONS} to ${MAX_QUESTIONS} questions; the reply had ${draft.length}.`;
  if (!draft.some((d) => d.kind === "why")) return 'Include at least one "why" question.';
  return draft.slice(0, MAX_QUESTIONS);
};
