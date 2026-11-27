import { isQuizSet } from "./items";
import { studyDay } from "./schedule";
import type { ChapterQuiz } from "./quiz";
import type { ActivityFile } from "./mastery";
import type { CardSet } from "./types";

/** The daily minimum: this many minutes of reading, reviewing and quizzing together... */
export const MINIMUM_MINUTES = 15;
/** ...or one review session: this many card ratings in the day (fewer when the library has fewer cards), or a chapter quiz taken. */
export const SESSION_RATINGS = 5;

/** What a study day held, as far as the minimum goes. */
export interface DayWork {
  seconds: number;
  ratings: number;
  quizzes: number;
  /** Live card sets the library had made by the end of that day, so a day is judged by the deck it had then. */
  cards: number;
}

/** Each study day's work across the library: time from the activity log, ratings from card histories, quiz attempts. */
export const dayWork = (activity: ActivityFile, books: readonly { cardSets: CardSet[]; quizzes: ChapterQuiz[] }[]): Map<string, DayWork> => {
  const days = new Map<string, DayWork>();
  const at = (day: string) => {
    let work = days.get(day);
    if (!work) days.set(day, (work = { seconds: 0, ratings: 0, quizzes: 0, cards: 0 }));
    return work;
  };
  for (const [day, byBook] of Object.entries(activity.days)) {
    for (const seconds of Object.values(byBook)) at(day).seconds += (seconds.reading ?? 0) + (seconds.review ?? 0) + (seconds.quiz ?? 0);
  }
  for (const book of books) {
    for (const set of book.cardSets) for (const record of set.history ?? []) at(studyDay(new Date(record.at))).ratings++;
    for (const quiz of book.quizzes) for (const attempt of quiz.attempts) at(studyDay(new Date(attempt.at))).quizzes++;
  }
  const made = books.flatMap((book) => book.cardSets.filter((set) => set.cues.length && !isQuizSet(set)).map((set) => studyDay(new Date(set.createdAt))));
  for (const [day, work] of days) work.cards = made.filter((madeOn) => madeOn <= day).length;
  return days;
};

/** Whether a day's work meets the minimum. A small deck makes a session with fewer ratings, judged by the deck that day had. */
export const meetsMinimum = (work: DayWork | undefined): boolean => {
  if (!work) return false;
  const session = Math.min(SESSION_RATINGS, work.cards);
  return work.seconds >= MINIMUM_MINUTES * 60 || (session > 0 && work.ratings >= session) || work.quizzes > 0;
};

/* Streaks. Day strings are YYYY-MM-DD study days, so the arithmetic is on calendar dates and daylight saving never moves a day. */

const toDate = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fromDate = (date: Date) => date.toISOString().slice(0, 10);
export const addDays = (day: string, count: number) => {
  const date = toDate(day);
  date.setUTCDate(date.getUTCDate() + count);
  return fromDate(date);
};
/** The Monday that starts the week a day is in: each week brings one rest day. */
export const weekOf = (day: string) => addDays(day, -((toDate(day).getUTCDay() + 6) % 7));

/** One free missed day a week, used up automatically by the first miss. */
export const REST_DAYS_PER_WEEK = 1;
/** Every this many days met in a row earns a freeze, which covers a miss once the week's rest day is gone. */
export const FREEZE_EVERY = 7;
/** Freezes bank up to this many. */
export const MAX_FREEZES = 2;

/** How a day stands: met; missed but covered by the rest day or a freeze; missed and breaking the streak; or today, still open. */
export type DayMark = "met" | "rest" | "freeze" | "missed" | "open";

export interface Streak {
  /** Days met in the running streak. Rest and freeze days keep it alive without adding to it. */
  current: number;
  longest: number;
  /** Freezes banked now. */
  freezes: number;
  /** Whether this week's rest day is still unused. */
  restLeft: boolean;
  todayMet: boolean;
  /** Each day from the first day met through today. */
  marks: Map<string, DayMark>;
}

/**
 * The streak as of `today`, from the days that met the minimum. Pure and recomputed each time, so nothing can drift:
 * walking from the first day met, a met day adds one; a missed day uses the week's rest day, else a banked freeze,
 * else ends the streak. Today never breaks it while it is still open. Misses with no streak running spend nothing.
 */
export const streakOf = (met: ReadonlySet<string>, today: string): Streak => {
  const marks = new Map<string, DayMark>();
  const first = [...met].filter((day) => day <= today).sort()[0];
  let current = 0;
  let longest = 0;
  let freezes = 0;
  let run = 0;
  let restsUsed = 0;
  let week = "";
  for (let day = first ?? today; first && day <= today; day = addDays(day, 1)) {
    if (weekOf(day) !== week) {
      week = weekOf(day);
      restsUsed = 0;
    }
    if (met.has(day)) {
      current++;
      run++;
      longest = Math.max(longest, current);
      if (run % FREEZE_EVERY === 0) freezes = Math.min(MAX_FREEZES, freezes + 1);
      marks.set(day, "met");
      continue;
    }
    if (day === today) {
      marks.set(day, "open");
      continue;
    }
    run = 0;
    if (current === 0) marks.set(day, "missed");
    else if (restsUsed < REST_DAYS_PER_WEEK) {
      restsUsed++;
      marks.set(day, "rest");
    } else if (freezes > 0) {
      freezes--;
      marks.set(day, "freeze");
    } else {
      current = 0;
      marks.set(day, "missed");
    }
  }
  if (weekOf(today) !== week) restsUsed = 0;
  return { current, longest, freezes, restLeft: restsUsed < REST_DAYS_PER_WEEK, todayMet: met.has(today), marks };
};
