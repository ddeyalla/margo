import { courseSteps, type Course } from "@/lib/shared/courses";
import { emptyActivity, minutes } from "@/lib/shared/mastery";
import { isPassed, stepStates, stepKey } from "@/lib/shared/quiz";
import { countWords, minutesLeft } from "@/lib/shared/reading-time";
import { reviewQueue, studyDay } from "@/lib/shared/schedule";
import { dayWork, MINIMUM_MINUTES, meetsMinimum, streakOf, type Streak } from "@/lib/shared/streak";
import type { BookId, BookState } from "@/lib/shared/types";
import { readActivity } from "./activity";
import { readCourses } from "./courses/store";
import { readLibrary } from "./library";
import { bookText } from "./search/index";
import { bookStateUpdatedAt, readBookState } from "./store";

export interface TodayBook {
  id: BookId;
  title: string;
}

/** The one thing Today's button starts, in order of what is most worth doing now. */
export type TodayStart =
  | { kind: "review"; book: TodayBook; due: number }
  | { kind: "quiz"; book: TodayBook; chapter: string; course: string }
  | { kind: "read"; book: TodayBook };

export interface Today {
  /** Cards ready to review now, over every book, and the book holding the most. */
  due: number;
  dueBook: TodayBook | null;
  /** The first Course chapter, in Course order, whose quiz is written and not passed yet. */
  quiz: { book: TodayBook; chapter: string; course: string } | null;
  /** The book last read, and about how many minutes are left in it (null when its text isn't indexed yet). */
  current: (TodayBook & { minutesLeft: number | null }) | null;
  start: TodayStart | null;
  /** Today's time so far, toward the minimum, and the streak. */
  minutesToday: number;
  minimumMinutes: number;
  streak: Streak;
}

const titleOf = (state: BookState | null, fileTitle: string) => state?.meta?.title || fileTitle;

/** What Today shows on home, read from every book's state, the Courses and the activity log. */
export const readToday = async (now = new Date()): Promise<Today> => {
  const [{ books }, { courses }, activity] = await Promise.all([readLibrary(), readCourses().catch(() => ({ courses: [] as Course[] })), readActivity().catch(emptyActivity)]);
  const entries = await Promise.all(
    books.map(async (book) => {
      const [state, updatedAt] = await Promise.all([readBookState(book.id).catch(() => null), bookStateUpdatedAt(book.id)]);
      return { id: book.id, title: titleOf(state, book.fileTitle), state, updatedAt };
    }),
  );
  const states = entries.flatMap((entry) => (entry.state ? [{ entry, state: entry.state }] : []));

  let due = 0;
  let dueBook: (TodayBook & { due: number }) | null = null;
  for (const { entry, state } of states) {
    const count = reviewQueue(state.cardSets, now).length;
    due += count;
    if (count && (!dueBook || count > dueBook.due)) dueBook = { id: entry.id, title: entry.title, due: count };
  }

  let quiz: Today["quiz"] = null;
  const byId = new Map(states.map(({ entry, state }) => [entry.id, { entry, state }]));
  outer: for (const course of courses) {
    const steps = courseSteps(course);
    const passed = new Set(steps.filter((step) => isPassed(byId.get(step.bookId)?.state.quizzes.find((q) => q.chapter === step.chapter))).map((step) => stepKey(step.bookId, step.chapter)));
    for (const step of stepStates(steps, passed)) {
      const found = byId.get(step.bookId);
      if (step.passed || !found?.state.quizzes.some((q) => q.chapter === step.chapter)) continue;
      quiz = { book: { id: found.entry.id, title: found.entry.title }, chapter: step.chapter, course: course.name };
      break outer;
    }
  }

  const last = entries
    .filter((entry) => entry.state?.position && entry.updatedAt)
    .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0))[0];
  let current: Today["current"] = null;
  if (last) {
    const text = await bookText(last.id, { extract: false }).catch(() => null);
    const words = text ? text.blocks.reduce((sum, block) => sum + countWords(block.text), 0) : 0;
    current = { id: last.id, title: last.title, minutesLeft: text ? minutesLeft(words, 1 - (last.state?.position?.fraction ?? 0)) : null };
  }

  const cards = states.reduce((sum, { state }) => sum + state.cardSets.filter((set) => set.cues.length).length, 0);
  const work = dayWork(
    activity,
    states.map(({ state }) => state),
  );
  const met = new Set([...work].filter(([, day]) => meetsMinimum(day, cards)).map(([day]) => day));
  const today = studyDay(now);

  const start: TodayStart | null = dueBook
    ? { kind: "review", book: { id: dueBook.id, title: dueBook.title }, due: dueBook.due }
    : quiz
      ? { kind: "quiz", ...quiz }
      : current && current.minutesLeft !== 0
        ? { kind: "read", book: { id: current.id, title: current.title } }
        : null;

  return {
    due,
    dueBook: dueBook && { id: dueBook.id, title: dueBook.title },
    quiz,
    current,
    start,
    minutesToday: minutes(work.get(today)?.seconds ?? 0),
    minimumMinutes: MINIMUM_MINUTES,
    streak: streakOf(met, today),
  };
};
