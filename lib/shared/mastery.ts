import { recordSignal, signalOf, type Signal } from "./confidence";
import { courseSteps, type Course } from "./courses";
import { isPassed, type ChapterQuiz } from "./quiz";
import { recallAt, replaySchedule, studyDay } from "./schedule";
import type { BookId, CardSet } from "./types";

/**
 * How much a right answer is worth to retention once its confidence is known. A right answer the reader was
 * close to guessing says less about memory than one they were sure of. A skipped rail is not held against
 * anyone, and wrong answers already pull recall down through their Again.
 */
const SIGNAL_WEIGHT: Record<Signal, number> = { held: 1, shaky: 0.85, lucky: 0.6, gap: 1, misconception: 1 };

export const confidenceWeight = (signal: Signal | null): number => (signal ? SIGNAL_WEIGHT[signal] : 1);

/** One thing the reader is meant to remember, with its predicted recall now (0 to 1) and how much a guess discounts it. */
export interface RecallItem {
  recall: number;
  weight: number;
}

/** A card set's recall now, discounted by the confidence of its latest rating. Null for a set never rated. */
export const cardRecall = (set: CardSet, now: Date): RecallItem | null => {
  const recall = recallAt(set.schedule, now);
  if (recall === null) return null;
  const last = set.history?.at(-1);
  return { recall, weight: confidenceWeight(last ? recordSignal(last) : null) };
};

/** Each question of a quiz with its recall now, from replaying every answer to it. Questions never answered are left out. */
export const quizRecall = (quiz: ChapterQuiz, now: Date): RecallItem[] =>
  quiz.questions.flatMap((question) => {
    const answers = quiz.attempts.flatMap((attempt) => attempt.answers.filter((a) => a.questionId === question.id).map((a) => ({ ...a, at: attempt.at })));
    const schedule = replaySchedule(answers);
    const recall = schedule && recallAt(schedule, now);
    if (recall === null || recall === undefined) return [];
    const last = answers.at(-1)!;
    return [{ recall, weight: confidenceWeight(signalOf(last.correct, last.confidence)) }];
  });

/** Average discounted recall, from 0 to 1, or null with nothing to go on yet. */
export const retention = (items: readonly RecallItem[]): number | null =>
  items.length ? items.reduce((sum, item) => sum + item.recall * item.weight, 0) / items.length : null;

/** What a Course needs from each of its books: the cards and quizzes in its state. */
export interface BookEvidence {
  cardSets: CardSet[];
  quizzes: ChapterQuiz[];
}

export interface Mastery {
  /** Chapters of the Course passed, out of the chapters it reads that the library has. */
  passed: number;
  chapters: number;
  /** Predicted recall over the Course's cards and quiz questions, 0 to 1, or null before any review. */
  retained: number | null;
  /** How many cards and questions retention is read from. */
  items: number;
}

/**
 * Coverage and retention of a Course, read from evidence at the moment asked. Cards count when made in a chapter
 * the Course reads, or in a section of one whose quiz recorded its sections. Nothing here is stored.
 */
export const courseMastery = (course: Pick<Course, "books" | "units">, books: ReadonlyMap<BookId, BookEvidence>, now: Date): Mastery => {
  const steps = courseSteps(course);
  const items: RecallItem[] = [];
  let passed = 0;
  const byBook = new Map<BookId, typeof steps>();
  for (const step of steps) byBook.set(step.bookId, [...(byBook.get(step.bookId) ?? []), step]);
  for (const [bookId, bookSteps] of byBook) {
    const evidence = books.get(bookId);
    if (!evidence) continue;
    const labels = new Set<string>();
    for (const step of bookSteps) {
      labels.add(step.chapter);
      const quiz = evidence.quizzes.find((q) => q.chapter === step.chapter);
      if (!quiz) continue;
      for (const label of quiz.labels ?? []) labels.add(label);
      if (isPassed(quiz)) passed++;
      items.push(...quizRecall(quiz, now));
    }
    for (const set of evidence.cardSets) {
      if (set.chapterTitle === null || !labels.has(set.chapterTitle)) continue;
      const item = cardRecall(set, now);
      if (item) items.push(item);
    }
  }
  return { passed, chapters: steps.length, retained: retention(items), items: items.length };
};

/** "62 % covered · 78 % retained", or what is missing. Never one blended number. */
export const masteryLine = (mastery: Mastery): string => {
  if (!mastery.chapters) return "No chapters in your library yet";
  const covered = `${Math.round((100 * mastery.passed) / mastery.chapters)} % covered`;
  return `${covered} · ${mastery.retained === null ? "nothing to retain yet" : `${Math.round(100 * mastery.retained)} % retained`}`;
};

/* Learning time. */

export const ACTIVITY_KINDS = ["reading", "review", "quiz"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const isActivityKind = (value: unknown): value is ActivityKind => ACTIVITY_KINDS.includes(value as ActivityKind);

/** Seconds of each kind, for one book on one study day. */
export type Seconds = Partial<Record<ActivityKind, number>>;

/** Learning time by study day (YYYY-MM-DD), then by book. Kept for good: streaks read it. */
export interface ActivityFile {
  days: Record<string, Record<string, Seconds>>;
}

export const emptyActivity = (): ActivityFile => ({ days: {} });

/** The most one report may add. The page reports every 30 seconds or so; anything more is a bug or a replay. */
export const MAX_REPORT_SECONDS = 120;
/** The most a book may gather on one day, all kinds together. */
export const MAX_DAY_SECONDS = 16 * 60 * 60;

/** A report's seconds as a whole number the store will take, or null. */
export const reportSeconds = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(MAX_REPORT_SECONDS, Math.round(value)) || null;
};

const total = (seconds: Seconds | undefined) => ACTIVITY_KINDS.reduce((sum, kind) => sum + (seconds?.[kind] ?? 0), 0);

/** Adds a report to the log, within the day's cap. */
export const addActivity = (file: ActivityFile, day: string, bookId: string, kind: ActivityKind, seconds: number): ActivityFile => {
  const books = file.days[day] ?? {};
  const current = books[bookId] ?? {};
  const room = Math.max(0, MAX_DAY_SECONDS - total(current));
  const added = Math.min(room, seconds);
  if (!added) return file;
  return { ...file, days: { ...file.days, [day]: { ...books, [bookId]: { ...current, [kind]: (current[kind] ?? 0) + added } } } };
};

/** The last `count` study days, oldest first, ending with today's. */
export const lastDays = (now: Date, count = 7): string[] => {
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i--) days.push(studyDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, now.getHours(), now.getMinutes())));
  return days;
};

export interface DayTime {
  day: string;
  /** Seconds of each kind that day, over the books asked about. */
  seconds: Required<Seconds>;
  total: number;
}

/** Each day's time, over every book or only the given ones. A book in two Courses counts once here. */
export const dayTimes = (file: ActivityFile, days: readonly string[], books?: ReadonlySet<string>): DayTime[] =>
  days.map((day) => {
    const seconds = { reading: 0, review: 0, quiz: 0 };
    for (const [bookId, time] of Object.entries(file.days[day] ?? {})) {
      if (books && !books.has(bookId)) continue;
      for (const kind of ACTIVITY_KINDS) seconds[kind] += time[kind] ?? 0;
    }
    return { day, seconds, total: seconds.reading + seconds.review + seconds.quiz };
  });

/** A day counts as learned with any time at all. The daily minimum that keeps a streak is Phase 19's. */
export const learned = (time: DayTime) => time.total > 0;

export const minutes = (seconds: number) => Math.round(seconds / 60);
