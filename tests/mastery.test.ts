import { describe, expect, it } from "vitest";
import type { Course } from "@/lib/shared/courses";
import {
  addActivity,
  cardRecall,
  courseMastery,
  dayTimes,
  emptyActivity,
  lastDays,
  masteryLine,
  MAX_DAY_SECONDS,
  quizRecall,
  reportSeconds,
  retention,
  type BookEvidence,
} from "@/lib/shared/mastery";
import type { ChapterQuiz } from "@/lib/shared/quiz";
import { applyReview, newSchedule, recallAt, replaySchedule } from "@/lib/shared/schedule";
import type { BookId, CardSet, Rating } from "@/lib/shared/types";

const start = new Date("2026-03-10T09:00:00Z");
const later = (days: number) => new Date(start.getTime() + days * 86_400_000);

const set = (chapterTitle: string | null, id = "s"): CardSet => ({
  id,
  anchor: { kind: "pdf", page: 1, start: 0, end: 5 },
  quote: "quote",
  chapterTitle,
  fact: "fact",
  cues: [{ id: "a", question: "Q?", answer: "A", createdAt: "", lastRating: null }],
  schedule: newSchedule(start),
  learningCueId: null,
  introducedOn: null,
  createdAt: start.toISOString(),
});

/** A set rated through to review: Good, then Good a day later. */
const learnedSet = (chapterTitle: string | null, rating: Rating = "good", confidence: number | null = null, id = "s"): CardSet => {
  let s = applyReview(set(chapterTitle, id), { cueId: "a", rating: "good", reps: 0 }, start);
  s = applyReview(s, { cueId: "a", rating, reps: s.schedule.reps, confidence }, later(1));
  return s;
};

const quiz = (chapter: string, correct: boolean[], labels?: string[]): ChapterQuiz => ({
  chapter,
  labels,
  questions: correct.map((_, i) => ({ id: `q${i}`, kind: "recall", question: "Q?", answer: "A", anchor: { kind: "pdf", page: 1, start: 0, end: 1 }, quote: "" })),
  createdAt: start.toISOString(),
  attempts: [
    {
      at: later(1).toISOString(),
      answers: correct.map((right, i) => ({ questionId: `q${i}`, correct: right, confidence: null, thinking: null })),
      passed: correct.filter(Boolean).length >= Math.ceil(correct.length * 0.8),
    },
  ],
});

describe("predicted recall", () => {
  it("has nothing to say about a set never rated", () => {
    expect(recallAt(newSchedule(start), start)).toBeNull();
    expect(cardRecall(set("One"), start)).toBeNull();
  });
  it("falls the longer nothing is reviewed", () => {
    const s = learnedSet("One");
    const soon = recallAt(s.schedule, later(2))!;
    const months = recallAt(s.schedule, later(120))!;
    expect(soon).toBeGreaterThan(0.85);
    expect(months).toBeLessThan(soon);
    expect(months).toBeGreaterThan(0);
  });
  it("gives a quiz question a schedule from its answers, so it fades too", () => {
    expect(replaySchedule([])).toBeNull();
    const right = replaySchedule([{ at: later(1).toISOString(), correct: true }])!;
    const wrong = replaySchedule([{ at: later(1).toISOString(), correct: false }])!;
    expect(recallAt(right, later(2))!).toBeGreaterThan(recallAt(wrong, later(2))!);
    expect(recallAt(right, later(90))!).toBeLessThan(recallAt(right, later(2))!);
  });
  it("discounts a right answer that was close to a guess, and never a skipped rail", () => {
    const sure = cardRecall(learnedSet("One", "good", 90), later(3))!;
    const guess = cardRecall(learnedSet("One", "good", 20), later(3))!;
    const skipped = cardRecall(learnedSet("One", "good", null), later(3))!;
    expect(sure.weight).toBe(1);
    expect(skipped.weight).toBe(1);
    expect(guess.weight).toBeLessThan(sure.weight);
    expect(retention([guess])!).toBeLessThan(retention([sure])!);
  });
  it("reads every answered quiz question, none unanswered", () => {
    const q = quiz("One", [true, true, false]);
    q.questions.push({ ...q.questions[0], id: "never" });
    expect(quizRecall(q, later(2))).toHaveLength(3);
  });
  it("has no retention before any evidence", () => {
    expect(retention([])).toBeNull();
  });
});

describe("a Course's mastery", () => {
  const a = "a".repeat(40) as BookId;
  const course: Pick<Course, "books" | "units"> = {
    books: [{ key: "A", title: "A", author: null, edition: null, bookId: a }],
    units: [
      {
        title: "U",
        weeks: null,
        concepts: [],
        readings: [{ book: "A", chapters: [{ title: "One", inBook: true }, { title: "Two", inBook: true }, { title: "Lost", inBook: false }] }],
      },
    ],
  } as unknown as Pick<Course, "books" | "units">;

  it("covers passed chapters out of the chapters found, and retains only its own cards", () => {
    const books = new Map<BookId, BookEvidence>([
      [a, { cardSets: [learnedSet("One", "good", null, "in"), learnedSet("Elsewhere", "again", null, "out"), set("Two", "new")], quizzes: [quiz("One", [true, true, true, true, true])] }],
    ]);
    const mastery = courseMastery(course, books, later(2));
    expect(mastery.passed).toBe(1);
    expect(mastery.chapters).toBe(2);
    expect(mastery.items).toBe(6);
    expect(masteryLine(mastery)).toMatch(/^50 % covered · \d+ % retained$/);
  });
  it("counts cards made in a section of a chapter whose quiz kept its sections", () => {
    const books = new Map<BookId, BookEvidence>([[a, { cardSets: [learnedSet("One, part 2")], quizzes: [quiz("One", [false, false, false, false, false], ["One", "One, part 2"])] }]]);
    const mastery = courseMastery(course, books, later(2));
    expect(mastery.passed).toBe(0);
    expect(mastery.items).toBe(6);
  });
  it("falls when reviewing stops", () => {
    const books = new Map<BookId, BookEvidence>([[a, { cardSets: [learnedSet("One")], quizzes: [quiz("One", [true, true, true, true, true])] }]]);
    expect(courseMastery(course, books, later(200)).retained!).toBeLessThan(courseMastery(course, books, later(3)).retained!);
  });
  it("says so when there is nothing yet", () => {
    const mastery = courseMastery(course, new Map(), start);
    expect(mastery.retained).toBeNull();
    expect(masteryLine(mastery)).toBe("0 % covered · nothing to retain yet");
  });
});

describe("learning time", () => {
  it("takes whole positive seconds, capped per report", () => {
    expect(reportSeconds(30)).toBe(30);
    expect(reportSeconds(29.6)).toBe(30);
    expect(reportSeconds(99_999)).toBe(120);
    for (const bad of [0, -5, Number.NaN, Infinity, "30", null]) expect(reportSeconds(bad)).toBeNull();
  });
  it("adds by day, book and kind, within the day's cap", () => {
    let file = addActivity(emptyActivity(), "2026-03-10", "b", "reading", 60);
    file = addActivity(file, "2026-03-10", "b", "quiz", 30);
    expect(file.days["2026-03-10"].b).toEqual({ reading: 60, quiz: 30 });
    const full = addActivity(emptyActivity(), "2026-03-10", "b", "reading", MAX_DAY_SECONDS);
    expect(addActivity(full, "2026-03-10", "b", "review", 60)).toBe(full);
  });
  it("lists the last seven study days, today last", () => {
    const days = lastDays(new Date(2026, 2, 10, 12));
    expect(days).toEqual(["2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"]);
    /* Before 4 a.m. still belongs to the day before. */
    expect(lastDays(new Date(2026, 2, 10, 2)).at(-1)).toBe("2026-03-09");
  });
  it("sums each day over all books or a Course's books", () => {
    let file = addActivity(emptyActivity(), "2026-03-10", "x", "reading", 120);
    file = addActivity(file, "2026-03-10", "y", "review", 60);
    const [all] = dayTimes(file, ["2026-03-10"]);
    expect(all.total).toBe(180);
    const [some] = dayTimes(file, ["2026-03-10"], new Set(["y"]));
    expect(some.seconds).toEqual({ reading: 0, review: 60, quiz: 0 });
    expect(dayTimes(file, ["2026-03-09"])[0].total).toBe(0);
  });
});
