import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyReview, intervalLabel, isDue, newSchedule, nextLearningAt, pickCue, previewDue, reviewQueue, studyDay } from "@/lib/shared/schedule";
import type { CardSet, Cue, Rating } from "@/lib/shared/types";

const cue = (id: string, lastRating: Rating | null = null): Cue => ({ id, question: `Q ${id}`, answer: `A ${id}`, createdAt: "", lastRating });

const set = (id: string, now: Date, cues: Cue[] = [cue("a"), cue("b")]): CardSet => ({
  id,
  anchor: { kind: "pdf", page: 1, start: 0, end: 5 },
  quote: "quote",
  chapterTitle: null,
  fact: "fact",
  cues,
  schedule: newSchedule(now),
  learningCueId: null,
  introducedOn: null,
  createdAt: now.toISOString(),
});

const minutes = (from: Date, to: Date | string) => Math.round((new Date(to).getTime() - from.getTime()) / 60_000);
const rate = (s: CardSet, rating: Rating, at: Date, cueId = s.cues[0].id) => applyReview(s, { cueId, rating, reps: s.schedule.reps }, at);

describe("scheduler", () => {
  let tz: string | undefined;
  beforeEach(() => {
    tz = process.env.TZ;
    process.env.TZ = "Europe/London";
  });
  afterEach(() => {
    process.env.TZ = tz;
  });

  const morning = new Date("2026-03-10T09:00:00Z");

  it("takes a new set through the 1 and 10 minute steps, then out to days", () => {
    let s = rate(set("s", morning), "good", morning);
    expect(s.schedule.state).toBe("learning");
    expect(minutes(morning, s.schedule.due)).toBe(10);

    const again = rate(set("t", morning), "again", morning);
    expect(minutes(morning, again.schedule.due)).toBe(1);

    const later = new Date(morning.getTime() + 10 * 60_000);
    s = rate(s, "good", later);
    expect(s.schedule.state).toBe("review");
    expect(minutes(later, s.schedule.due)).toBeGreaterThanOrEqual(24 * 60);
  });

  it("sends a forgotten review back for 10 minutes", () => {
    let s = rate(set("s", morning), "easy", morning);
    expect(s.schedule.state).toBe("review");
    const due = new Date(s.schedule.due);
    s = rate(s, "again", due, "b");
    expect(s.schedule.state).toBe("relearning");
    expect(s.schedule.lapses).toBe(1);
    expect(minutes(due, s.schedule.due)).toBe(10);
  });

  it("keeps showing the cue that failed until the set graduates", () => {
    let s = rate(set("s", morning), "again", morning, "b");
    expect(s.learningCueId).toBe("b");
    expect(pickCue(s, 0).id).toBe("b");
    expect(pickCue(s, 0.99).id).toBe("b");
    s = rate(s, "good", new Date(s.schedule.due), "b");
    s = rate(s, "good", new Date(s.schedule.due), "b");
    expect(s.schedule.state).toBe("review");
    expect(s.learningCueId).toBeNull();
  });

  it("favours weaker cues by their last rating without ruling any out", () => {
    const s = set("s", morning, [cue("again", "again"), cue("easy", "easy"), cue("new")]);
    /* Weights 4, 1 and 3 out of 8. */
    expect(pickCue(s, 0).id).toBe("again");
    expect(pickCue(s, 0.49).id).toBe("again");
    expect(pickCue(s, 0.5).id).toBe("easy");
    expect(pickCue(s, 0.62).id).toBe("easy");
    expect(pickCue(s, 0.63).id).toBe("new");
    expect(pickCue(s, 0.999).id).toBe("new");
  });

  it("ignores a rating sent twice for the same showing", () => {
    const shown = set("s", morning);
    const review = { cueId: "a", rating: "good" as const, reps: shown.schedule.reps };
    const once = applyReview(shown, review, morning);
    expect(applyReview(once, review, morning)).toBe(once);
    expect(applyReview(shown, { ...review, cueId: "gone" }, morning)).toBe(shown);
  });

  it("previews when each rating would bring the set back", () => {
    const preview = previewDue(set("s", morning).schedule, morning);
    expect(minutes(morning, preview.again)).toBe(1);
    expect(minutes(morning, preview.good)).toBe(10);
    expect(preview.easy.getTime()).toBeGreaterThan(preview.good.getTime());
    expect(intervalLabel(morning, preview.again)).toBe("1m");
  });

  it("starts the study day at 4 am local time", () => {
    expect(studyDay(new Date("2026-03-10T03:59:00Z"))).toBe("2026-03-09");
    expect(studyDay(new Date("2026-03-10T04:00:00Z"))).toBe("2026-03-10");
  });

  it("keeps the 4 am boundary across the clocks changing", () => {
    /* UK clocks go forward on 29 March 2026: 4 am local is then 03:00 UTC. */
    expect(studyDay(new Date("2026-03-29T02:59:00Z"))).toBe("2026-03-28");
    expect(studyDay(new Date("2026-03-29T03:00:00Z"))).toBe("2026-03-29");
    /* And back on 25 October 2026: 4 am local is 04:00 UTC again. */
    expect(studyDay(new Date("2026-10-25T03:59:00Z"))).toBe("2026-10-24");
    expect(studyDay(new Date("2026-10-25T04:00:00Z"))).toBe("2026-10-25");
  });

  it("makes a review due for its whole study day, but a learning step only at its minute", () => {
    const review = { ...newSchedule(morning), state: "review" as const, due: "2026-03-10T20:00:00Z" };
    expect(isDue(review, morning)).toBe(true);
    expect(isDue(review, new Date("2026-03-10T03:00:00Z"))).toBe(false);
    const step = { ...newSchedule(morning), state: "learning" as const, due: "2026-03-10T09:10:00Z" };
    expect(isDue(step, morning)).toBe(false);
    expect(isDue(step, new Date("2026-03-10T09:10:00Z"))).toBe(true);
  });

  it("queues ready steps, then due reviews, then new sets up to what is left of today's limit", () => {
    const step = { ...set("step", morning), schedule: { ...newSchedule(morning), state: "learning" as const, due: "2026-03-10T08:00:00Z" } };
    const review = { ...set("review", morning), schedule: { ...newSchedule(morning), state: "review" as const, due: "2026-03-09T12:00:00Z" } };
    const notYet = { ...set("later", morning), schedule: { ...newSchedule(morning), state: "learning" as const, due: "2026-03-10T09:30:00Z" } };
    const introducedToday = { ...review, id: "seen", introducedOn: studyDay(morning), schedule: { ...review.schedule, due: "2026-03-20T00:00:00Z" } };
    const fresh = ["n1", "n2", "n3"].map((id, i) => ({ ...set(id, new Date(morning.getTime() + i)) }));
    const empty = set("empty", morning, []);
    const queue = reviewQueue([...fresh, empty, notYet, review, step, introducedToday], morning, { newPerDay: 3, reviewsPerDay: 60 });
    expect(queue.map((s) => s.id)).toEqual(["step", "review", "n1", "n2"]);
    expect(nextLearningAt([notYet, step], morning)?.toISOString()).toBe("2026-03-10T09:30:00.000Z");
  });
});
