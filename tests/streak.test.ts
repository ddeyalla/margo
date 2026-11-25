import { describe, expect, it } from "vitest";
import { addActivity, emptyActivity } from "@/lib/shared/mastery";
import { applyReview, newSchedule } from "@/lib/shared/schedule";
import { addDays, dayWork, MAX_FREEZES, meetsMinimum, streakOf, weekOf } from "@/lib/shared/streak";
import type { CardSet } from "@/lib/shared/types";

/* 2026-03-02 is a Monday. */
const MON = "2026-03-02";
const days = (from: string, count: number) => Array.from({ length: count }, (_, i) => addDays(from, i));
const met = (...lists: string[][]) => new Set(lists.flat());

describe("day arithmetic", () => {
  it("adds across months and years, and finds each week's Monday", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays(MON, -1)).toBe("2026-03-01");
    expect(weekOf("2026-03-08")).toBe(MON);
    expect(weekOf(MON)).toBe(MON);
    expect(weekOf("2026-03-09")).toBe("2026-03-09");
  });
  it("is not moved by daylight saving (US clocks change on 2026-03-08)", () => {
    expect(days("2026-03-07", 3)).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
  });
});

describe("streakOf", () => {
  it("is zero with nothing met, and leaves the rest day untouched", () => {
    const streak = streakOf(new Set(), MON);
    expect(streak).toMatchObject({ current: 0, longest: 0, freezes: 0, restLeft: true, todayMet: false });
    expect(streak.marks.size).toBe(0);
  });
  it("counts days met in a row, today included once met", () => {
    expect(streakOf(met(days(MON, 3)), addDays(MON, 2))).toMatchObject({ current: 3, todayMet: true });
  });
  it("keeps yesterday's streak while today is still open", () => {
    const streak = streakOf(met(days(MON, 3)), addDays(MON, 3));
    expect(streak.current).toBe(3);
    expect(streak.marks.get(addDays(MON, 3))).toBe("open");
  });
  it("covers one missed day a week with the rest day, without counting it", () => {
    const streak = streakOf(met(days(MON, 2), days(addDays(MON, 3), 2)), addDays(MON, 4));
    expect(streak.current).toBe(4);
    expect(streak.marks.get(addDays(MON, 2))).toBe("rest");
    expect(streak.restLeft).toBe(false);
  });
  it("breaks on a second miss in the same week with no freeze", () => {
    /* Mon, Tue met; Wed rest; Thu met; Fri missed; Sat met. */
    const streak = streakOf(met(days(MON, 2), [addDays(MON, 3), addDays(MON, 5)]), addDays(MON, 5));
    expect(streak.marks.get(addDays(MON, 4))).toBe("missed");
    expect(streak.current).toBe(1);
    expect(streak.longest).toBe(3);
  });
  it("gives a new rest day each week", () => {
    /* Miss Wednesday of week one and Wednesday of week two. */
    const weekTwo = addDays(MON, 7);
    const streak = streakOf(met(days(MON, 2), days(addDays(MON, 3), 6), days(addDays(weekTwo, 3), 2)), addDays(weekTwo, 4));
    expect(streak.marks.get(addDays(MON, 2))).toBe("rest");
    expect(streak.marks.get(addDays(weekTwo, 2))).toBe("rest");
    expect(streak.current).toBe(10);
  });
  it("earns a freeze every seven days met in a row and spends it after the rest day", () => {
    /* Seven days met (Mon to Sun) earn one; next week miss Mon (rest) and Tue (freeze). */
    const weekTwo = addDays(MON, 7);
    const before = streakOf(met(days(MON, 7)), addDays(MON, 6));
    expect(before.freezes).toBe(1);
    const streak = streakOf(met(days(MON, 7), days(addDays(weekTwo, 2), 2)), addDays(weekTwo, 3));
    expect(streak.marks.get(weekTwo)).toBe("rest");
    expect(streak.marks.get(addDays(weekTwo, 1))).toBe("freeze");
    expect(streak.freezes).toBe(0);
    expect(streak.current).toBe(9);
  });
  it("banks at most two freezes", () => {
    expect(streakOf(met(days(MON, 35)), addDays(MON, 34)).freezes).toBe(MAX_FREEZES);
  });
  it("needs seven days in a row again to earn the next freeze after a miss", () => {
    /* Six met, a rest day, six met: no freeze yet. */
    const streak = streakOf(met(days(MON, 6), days(addDays(MON, 7), 6)), addDays(MON, 12));
    expect(streak.freezes).toBe(0);
    expect(streak.current).toBe(12);
  });
  it("ends after a long gap even with freezes banked", () => {
    const back = addDays(MON, 14 + 10);
    const streak = streakOf(met(days(MON, 14), [back]), back);
    expect(streak.current).toBe(1);
    expect(streak.longest).toBe(14);
  });
  it("spends nothing on misses before the first streak or after it ended", () => {
    const later = addDays(MON, 9);
    const streak = streakOf(met([MON], [later]), later);
    expect(streak.marks.get(addDays(MON, 1))).toBe("rest");
    expect(streak.marks.get(addDays(MON, 2))).toBe("missed");
    expect(streak.marks.get(addDays(MON, 3))).toBe("missed");
    /* The second week's rest day was never spent: there was no streak to save. */
    expect(streak.restLeft).toBe(true);
    expect(streak.current).toBe(1);
  });
  it("ignores days after today", () => {
    expect(streakOf(met([MON, addDays(MON, 5)]), MON).current).toBe(1);
  });
});

describe("the daily minimum", () => {
  const at = new Date(2026, 2, 3, 12);
  const card = (ratings: number): CardSet => {
    let set: CardSet = {
      id: "s",
      anchor: { kind: "pdf", page: 1, start: 0, end: 1 },
      quote: "",
      chapterTitle: null,
      fact: "",
      cues: [{ id: "a", question: "Q", answer: "A", createdAt: "", lastRating: null }],
      schedule: newSchedule(at),
      learningCueId: null,
      introducedOn: null,
      createdAt: at.toISOString(),
    };
    for (let i = 0; i < ratings; i++) set = applyReview(set, { cueId: "a", rating: "good", reps: set.schedule.reps }, new Date(at.getTime() + i * 60_000));
    return set;
  };

  it("is fifteen minutes of any kind together", () => {
    let activity = addActivity(emptyActivity(), "2026-03-03", "x", "reading", 600);
    expect(meetsMinimum(dayWork(activity, []).get("2026-03-03"))).toBe(false);
    activity = addActivity(activity, "2026-03-03", "y", "review", 300);
    expect(meetsMinimum(dayWork(activity, []).get("2026-03-03"))).toBe(true);
  });
  it("or a review session of five ratings, fewer for a small deck", () => {
    const work = dayWork(emptyActivity(), [{ cardSets: [card(3)], quizzes: [] }]).get("2026-03-03");
    expect(work).toMatchObject({ ratings: 3, cards: 1 });
    expect(meetsMinimum(work)).toBe(true);
    expect(meetsMinimum({ ...work!, cards: 20 })).toBe(false);
    expect(meetsMinimum({ seconds: 0, ratings: 0, quizzes: 0, cards: 0 })).toBe(false);
  });
  it("judges a past day by the deck it had, so making cards later never un-meets it", () => {
    const later = (set: CardSet, i: number): CardSet => ({ ...set, id: `later${i}`, history: [], createdAt: new Date(2026, 2, 9, 12).toISOString() });
    const deck = [card(1), { ...card(1), id: "t" }];
    const before = dayWork(emptyActivity(), [{ cardSets: deck, quizzes: [] }]).get("2026-03-03");
    const after = dayWork(emptyActivity(), [{ cardSets: [...deck, ...Array.from({ length: 8 }, (_, i) => later(card(0), i))], quizzes: [] }]).get("2026-03-03");
    expect(before).toMatchObject({ ratings: 2, cards: 2 });
    expect(after).toMatchObject({ ratings: 2, cards: 2 });
    expect(meetsMinimum(after)).toBe(true);
  });
  it("or a chapter quiz taken", () => {
    const quiz = { chapter: "One", questions: [], createdAt: "", attempts: [{ at: at.toISOString(), answers: [], passed: false }] };
    expect(meetsMinimum(dayWork(emptyActivity(), [{ cardSets: [], quizzes: [quiz] }]).get("2026-03-03"))).toBe(true);
  });
  it("is not met on a day with nothing", () => {
    expect(meetsMinimum(undefined)).toBe(false);
  });
});
