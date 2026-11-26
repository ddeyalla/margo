import { chapterSpan, MAX_QUESTIONS, passMark, type AttemptKind, type ChapterQuiz, type QuizAnswer, type QuizAttempt, type QuizQuestion, type QuizSkip } from "./quiz";
import { studyDay } from "./schedule";

/* A sitting is one go at a test: the end-of-chapter test, which mixes in questions from earlier chapters, or the
   short retest of its misses a day later. Everything here is worked out from the saved quizzes; nothing is a model call. */

type Entry = { label: string; depth: number };

/** A top-level entry that only groups chapters: "Part One", "Book II". Its chapters are the entries one level down. */
const PART = /^(part|book|volume)\b/i;

/** Entries that are not chapters to be tested on, when the label is exactly one of these. */
const NOT_A_CHAPTER =
  /^(cover|title( page)?|half[- ]title|copyright|imprint|(table of )?contents|dedication|epigraph|acknowledge?ments?|index|(end)?notes|bibliography|references|further reading|glossary|about the (author|publisher)s?|also by|praise|colophon|credits)$/i;

/**
 * The chapters of a book that get a test of their own, by contents label, in reading order. A chapter is a top-level
 * entry of the contents, or an entry directly under a top-level "Part …". Sections nested in a chapter are covered by
 * its test and get none. A Course names its own chapters, at whatever level, so an entry that overlaps one of those
 * is left to the Course and is not in the result. A label used twice names its first entry only, as a quiz does.
 */
export const bookChapters = (toc: readonly Entry[], courseChapters: readonly string[] = []): string[] => {
  const taken = courseChapters.flatMap((label) => chapterSpan(toc, label) ?? []);
  const chapters: string[] = [];
  let inPart = false;
  toc.forEach((entry, index) => {
    if (entry.depth === 0) inPart = PART.test(entry.label) && toc[index + 1]?.depth === 1;
    if (entry.depth > 1 || (entry.depth === 1) !== inPart || NOT_A_CHAPTER.test(entry.label.trim())) return;
    const span = chapterSpan(toc, entry.label);
    if (!span || span.start !== index || taken.some((other) => other.start < span.end && span.start < other.end)) return;
    chapters.push(entry.label);
  });
  return chapters;
};

/**
 * The quizzes of chapters that come before one in the book: by the contents when it is known, else by when they
 * were written.
 */
export const earlierQuizzes = (quizzes: readonly ChapterQuiz[], chapter: string, toc: readonly Entry[] | null): ChapterQuiz[] => {
  const quiz = quizzes.find((q) => q.chapter === chapter);
  const start = toc && chapterSpan(toc, chapter)?.start;
  if (toc && start !== null && start !== undefined) {
    return quizzes.filter((q) => {
      const other = chapterSpan(toc, q.chapter);
      return other !== null && other.start < start;
    });
  }
  return quiz ? quizzes.filter((q) => q.createdAt < quiz.createdAt) : [];
};

/**
 * The questions of a quiz a test may ask: the ones checked against the chapter's text. A quiz saved before checking
 * existed has none checked, and is asked as it was written rather than not at all.
 */
export const askable = (quiz: ChapterQuiz): QuizQuestion[] => {
  const verified = quiz.questions.filter((question) => question.verifiedAt);
  return verified.length ? verified : quiz.questions;
};

/** One question as a sitting asks it. */
export interface TestItem {
  /** The chapter whose quiz the question belongs to. */
  chapter: string;
  question: QuizQuestion;
  /** "recall": see the answer, then mark yourself. "explain": write an answer, which is graded against the text. */
  format: "recall" | "explain";
  /** From an earlier chapter than the one the test is for. */
  review: boolean;
}

/** A chapter's own questions in a test that also asks from earlier chapters. */
export const OWN_ITEMS = 6;
/** Questions from earlier chapters in a test, and the size a test is filled up to with them when the chapter's quiz is short. */
export const REVIEW_ITEMS = 2;
export const TEST_ITEMS = 6;
/** A retest asks the misses, up to this many, and is filled up to the smaller number from the rest of the test. */
export const RETEST_MAX = 4;
export const RETEST_MIN = 3;

type Candidate = { chapter: string; question: QuizQuestion; last: { at: string; correct: boolean } | null };

/** Each askable question of a quiz with the latest answer to it, from any sitting. */
const candidates = (quiz: ChapterQuiz, questions: readonly QuizQuestion[]): Candidate[] =>
  questions.map((question) => {
    let last: Candidate["last"] = null;
    for (const attempt of quiz.attempts) {
      const answer = attempt.answers.find((a) => a.questionId === question.id);
      if (answer && (!last || attempt.at >= last.at)) last = { at: attempt.at, correct: answer.correct };
    }
    return { chapter: quiz.chapter, question, last };
  });

/** What most needs asking: last answered wrong, then never asked, then answered right. */
const need = (candidate: Candidate) => (candidate.last ? (candidate.last.correct ? 2 : 0) : 1);

/**
 * Picks `count` of the candidates by need, keeping their order. Where a group of equal need doesn't all fit, the
 * ones taken are spread evenly through it, so a first test still runs from the start of the chapter to its end.
 */
const pick = (all: readonly Candidate[], count: number): Candidate[] => {
  if (count >= all.length) return [...all];
  const taken = new Set<Candidate>();
  for (const level of [0, 1, 2]) {
    const group = all.filter((candidate) => need(candidate) === level).sort((a, b) => (a.last?.at ?? "").localeCompare(b.last?.at ?? ""));
    const room = count - taken.size;
    if (group.length <= room) group.forEach((candidate) => taken.add(candidate));
    else for (let i = 0; i < room; i++) taken.add(group[Math.floor((i * group.length) / room)]);
  }
  return all.filter((candidate) => taken.has(candidate));
};

/**
 * The questions of a chapter's test, in the order asked. About seven in ten are the chapter's own and the rest come
 * from earlier chapters' quizzes, the ones last answered wrong or never asked first; with no earlier questions it is
 * the chapter's own, as a quiz was. One of the chapter's questions, a "why" when it has one, is asked as an explain:
 * answered in writing and graded. Only checked questions are drawn from other chapters.
 */
export const composeTest = (quiz: ChapterQuiz, earlier: readonly ChapterQuiz[]): TestItem[] => {
  const own = candidates(quiz, askable(quiz));
  const pool = earlier.flatMap((other) => candidates(other, other.questions.filter((question) => question.verifiedAt)));
  const reviewCount = Math.min(pool.length, Math.max(REVIEW_ITEMS, TEST_ITEMS - Math.min(own.length, OWN_ITEMS)));
  const ownCount = Math.min(own.length, reviewCount ? OWN_ITEMS : MAX_QUESTIONS);

  /* The explain is chosen first, so trimming the chapter's questions never drops the only "why". */
  const whys = own.filter((candidate) => candidate.question.kind === "why");
  const explain = pick(whys.length ? whys : own, 1)[0];
  const rest = pick(own.filter((candidate) => candidate !== explain), ownCount - 1);
  const chosen = own.filter((candidate) => candidate === explain || rest.includes(candidate));

  const items: TestItem[] = chosen.map(({ chapter, question }) => ({ chapter, question, format: question === explain.question ? "explain" : "recall", review: false }));
  /* Earlier chapters' questions go in among the chapter's own, evenly, never first. */
  pick(pool, reviewCount).forEach(({ chapter, question }, i) => {
    const at = Math.round(((i + 1) * (chosen.length + 1)) / (reviewCount + 1)) + i;
    items.splice(Math.min(at, items.length), 0, { chapter, question, format: "recall", review: true });
  });
  return items;
};

/** A sitting under way: what is still to ask, where the reader is, and the first answer given to each question. */
export interface Sitting {
  queue: TestItem[];
  index: number;
  answers: QuizAnswer[];
}

export const startSitting = (items: readonly TestItem[]): Sitting => ({ queue: [...items], index: 0, answers: [] });

export const sittingDone = (sitting: Sitting): boolean => sitting.index >= sitting.queue.length;

/** Whether the question now up is one missed earlier in this sitting, asked once more. */
export const isRepeat = (sitting: Sitting): boolean => sitting.answers.some((answer) => answer.questionId === sitting.queue[sitting.index]?.question.id);

/**
 * Takes the answer to the question now up and moves on. A miss puts the question at the end to be asked once more;
 * the second go is kept on the first answer as `again` and never asked a third time. The score is the first answers.
 */
export const answerSitting = (sitting: Sitting, answer: QuizAnswer): Sitting => {
  const item = sitting.queue[sitting.index];
  if (!item) return sitting;
  const index = sitting.index + 1;
  if (isRepeat(sitting)) {
    return { ...sitting, index, answers: sitting.answers.map((first) => (first.questionId === item.question.id ? { ...first, again: answer.correct } : first)) };
  }
  return { queue: answer.correct ? sitting.queue : [...sitting.queue, item], index, answers: [...sitting.answers, answer] };
};

/** A finished sitting as the reader's side hands it over to be saved. */
export interface SittingRecord {
  /** The chapter the test or retest is for. */
  chapter: string;
  kind: Exclude<AttemptKind, "review">;
  /** For a retest: the `at` of the test it follows. */
  retestOf?: string;
  answers: readonly QuizAnswer[];
}

/**
 * Saves a sitting into the book's quizzes: each answer goes to the quiz its question belongs to, so a question's
 * history stays in one place, and every attempt written carries the same time. Only a test can pass a chapter, at
 * 80 % of everything it asked, and only when it asked enough of the chapter's own questions. Answers to questions
 * the book doesn't have, and second answers, are dropped. Null when the chapter has no quiz.
 */
export const recordSitting = (quizzes: readonly ChapterQuiz[], { chapter, kind, retestOf, answers }: SittingRecord, at: Date): ChapterQuiz[] | null => {
  const target = quizzes.find((quiz) => quiz.chapter === chapter);
  if (!target) return null;
  const owner = new Map<string, string>();
  for (const quiz of quizzes) for (const question of quiz.questions) if (!owner.has(question.id)) owner.set(question.id, quiz.chapter);
  const seen = new Set<string>();
  const kept = answers.filter((answer) => owner.has(answer.questionId) && !seen.has(answer.questionId) && !!seen.add(answer.questionId));
  const of = kept.length;
  const right = kept.filter((answer) => answer.correct).length;
  const mine = (label: string) => kept.filter((answer) => owner.get(answer.questionId) === label);
  const passed = kind === "test" && mine(chapter).length >= Math.min(askable(target).length, OWN_ITEMS) && right >= passMark(of);
  const time = at.toISOString();
  return quizzes.map((quiz) => {
    const own = mine(quiz.chapter);
    if (quiz.chapter === chapter) {
      const attempt: QuizAttempt = { at: time, answers: own, passed, kind, right, of, ...(kind === "retest" && retestOf ? { retestOf } : {}) };
      return { ...quiz, attempts: [...quiz.attempts, attempt] };
    }
    return own.length ? { ...quiz, attempts: [...quiz.attempts, { at: time, answers: own, passed: false, kind: "review" as const }] } : quiz;
  });
};

/** The retest a chapter's last test left to do: which test it follows, and what it asks. */
export interface Retest {
  chapter: string;
  of: string;
  items: TestItem[];
  /** How many of the items were missed in the test; the rest fill it up. */
  missed: number;
}

/**
 * The retest of a chapter's latest test, from the study day after it: the questions missed in it, up to four, filled
 * up to three with the ones the reader was least sure of. Null when the test had no misses, when its retest was taken
 * or passed over, or when it is still the day of the test. A newer test replaces an older one's retest.
 */
export const retestDue = (quizzes: readonly ChapterQuiz[], chapter: string, skips: readonly QuizSkip[], now: Date): Retest | null => {
  const quiz = quizzes.find((q) => q.chapter === chapter);
  const test = quiz?.attempts.findLast((attempt) => attempt.kind === "test");
  if (!quiz || !test || studyDay(now) <= studyDay(new Date(test.at))) return null;
  if (quiz.attempts.some((attempt) => attempt.retestOf === test.at) || skips.some((skip) => skip.chapter === chapter && skip.retestOf === test.at)) return null;
  const asked = quizzes.flatMap((other) =>
    other.attempts
      .filter((attempt) => attempt.at === test.at)
      .flatMap((attempt) => attempt.answers)
      .flatMap((answer) => {
        const question = other.questions.find((q) => q.id === answer.questionId);
        return question ? [{ answer, item: { chapter: other.chapter, question, format: answer.turn ? "explain" : "recall", review: other.chapter !== chapter } satisfies TestItem }] : [];
      }),
  );
  const misses = asked.filter(({ answer }) => !answer.correct).slice(0, RETEST_MAX);
  if (!misses.length) return null;
  const fill = asked
    .filter(({ answer }) => answer.correct)
    .sort((a, b) => (a.answer.confidence ?? 101) - (b.answer.confidence ?? 101))
    .slice(0, Math.max(0, RETEST_MIN - misses.length));
  return { chapter, of: test.at, items: [...misses, ...fill].map(({ item }) => item), missed: misses.length };
};

/** The first retest that is due in the book, in the order its quizzes were written. */
export const nextRetest = (quizzes: readonly ChapterQuiz[], skips: readonly QuizSkip[], now: Date): Retest | null => {
  for (const quiz of quizzes) {
    const due = retestDue(quizzes, quiz.chapter, skips, now);
    if (due) return due;
  }
  return null;
};
