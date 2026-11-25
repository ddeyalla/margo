import { describe, expect, it } from "vitest";
import { cardRequest } from "@/lib/server/cards/generate";
import { cleanStance, isMisleading, lastRecord, signalOf } from "@/lib/shared/confidence";
import { applyReview, HISTORY_LIMIT, newSchedule, pickCue } from "@/lib/shared/schedule";
import type { CardSet, Cue, Rating, ReviewRecord } from "@/lib/shared/types";

const now = new Date("2026-03-10T09:00:00Z");

const cue = (id: string, lastRating: Rating | null = null): Cue => ({ id, question: `Q ${id}?`, answer: `A ${id}`, createdAt: "", lastRating });

const set = (overrides: Partial<CardSet> = {}): CardSet => ({
  id: "s",
  anchor: { kind: "pdf", page: 1, start: 0, end: 5 },
  quote: "quote",
  chapterTitle: null,
  fact: "fact",
  cues: [cue("a"), cue("b")],
  schedule: newSchedule(now),
  learningCueId: null,
  introducedOn: null,
  createdAt: now.toISOString(),
  ...overrides,
});

const record = (cueId: string, rating: Rating, confidence: number | null, thinking: string | null = null): ReviewRecord => ({
  at: now.toISOString(),
  cueId,
  rating,
  confidence,
  thinking,
});

describe("what an answer's confidence means", () => {
  it("tells a held fact from a lucky guess, and a known gap from a misconception", () => {
    expect(signalOf(true, 100)).toBe("held");
    expect(signalOf(true, 70)).toBe("held");
    expect(signalOf(true, 69)).toBe("shaky");
    expect(signalOf(true, 40)).toBe("shaky");
    expect(signalOf(true, 39)).toBe("lucky");
    expect(signalOf(true, 0)).toBe("lucky");
    expect(signalOf(false, 70)).toBe("misconception");
    expect(signalOf(false, 69)).toBe("gap");
  });

  it("reads nothing into a skipped rail", () => {
    expect(signalOf(true, null)).toBeNull();
    expect(signalOf(false, null)).toBeNull();
  });

  it("stores a skip as null, and trims and caps the thinking line", () => {
    expect(cleanStance(null, "   ")).toEqual({ confidence: null, thinking: null });
    expect(cleanStance(55, "  it was\nthe  cache ")).toEqual({ confidence: 55, thinking: "it was the cache" });
    expect(cleanStance(null, "x".repeat(900)).thinking).toHaveLength(500);
  });
});

describe("keeping the ratings", () => {
  it("records each rating with what the reader said before the answer", () => {
    const rated = applyReview(set(), { cueId: "a", rating: "good", reps: 0, confidence: 30, thinking: "a guess" }, now);
    expect(rated.history).toEqual([record("a", "good", 30, "a guess")]);
    const skipped = applyReview(rated, { cueId: "b", rating: "again", reps: 1 }, now);
    expect(skipped.history?.[1]).toEqual(record("b", "again", null));
  });

  it("keeps a stale rating out of the history", () => {
    const rated = applyReview(set(), { cueId: "a", rating: "good", reps: 0, confidence: 30 }, now);
    expect(applyReview(rated, { cueId: "a", rating: "easy", reps: 0, confidence: 90 }, now)).toBe(rated);
  });

  it("keeps only the latest ratings", () => {
    let current = set();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) current = applyReview(current, { cueId: "a", rating: "good", reps: i, confidence: i % 101 }, now);
    expect(current.history).toHaveLength(HISTORY_LIMIT);
    expect(current.history?.at(-1)?.confidence).toBe(HISTORY_LIMIT + 4);
    expect(lastRecord(current, "a")?.confidence).toBe(HISTORY_LIMIT + 4);
  });
});

describe("a confident wrong answer", () => {
  it("brings its cue back more than any other", () => {
    const s = set({ cues: [cue("a", "again"), cue("b", "again")], history: [record("a", "again", 90), record("b", "again", 20)] });
    /* Weights 6 and 4: "a" takes the first 60 %. */
    expect(pickCue(s, 0.59).id).toBe("a");
    expect(pickCue(s, 0.61).id).toBe("b");
  });

  it("marks a cue as misleading the second time, and tells the card writer why", () => {
    const once = set({ history: [record("a", "again", 90, "I mixed it up with caching")] });
    expect(isMisleading(once, "a")).toBe(false);
    const twice = set({ history: [...once.history!, record("a", "again", 80, "the name sounds like caching")] });
    expect(isMisleading(twice, "a")).toBe(true);
    expect(isMisleading(twice, "b")).toBe(false);

    const request = cardRequest({ title: "Book", author: null }, { quote: "q", before: "", after: "", chapterTitle: null }, twice);
    expect(request).toContain("- Q a?\n  (Answered wrong while sure 2 times. Last time the reader was thinking: \"the name sounds like caching\")");
    expect(request).toContain("- Q b?\n");
    expect(request).toMatch(/bad cue, not a bad reader/);
    expect(cardRequest({ title: "Book", author: null }, { quote: "q", before: "", after: "", chapterTitle: null }, set())).not.toMatch(/bad cue/);
  });
});
