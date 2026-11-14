import { describe, expect, it } from "vitest";
import { countWords, minutesLeft, minutesLeftLabel } from "@/lib/shared/reading-time";
import { AWAY_MS, recentMarks, shouldShowResume, tailExcerpt } from "@/lib/shared/resume";
import type { Highlight, Note } from "@/lib/shared/types";

const now = new Date("2026-11-14T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe("showing where the reader left off", () => {
  it("shows after half an hour away, with a saved place", () => {
    expect(shouldShowResume(true, ago(AWAY_MS), now)).toBe(true);
    expect(shouldShowResume(true, ago(3 * 24 * 3600 * 1000), now)).toBe(true);
  });

  it("stays quiet for a short break, no saved place, or an unknown time", () => {
    expect(shouldShowResume(true, ago(AWAY_MS - 1000), now)).toBe(false);
    expect(shouldShowResume(false, ago(AWAY_MS * 4), now)).toBe(false);
    expect(shouldShowResume(true, null, now)).toBe(false);
    expect(shouldShowResume(true, "not a date", now)).toBe(false);
  });

  it("stays quiet when the saved time is in the future", () => {
    expect(shouldShowResume(true, ago(-60_000), now)).toBe(false);
  });
});

const highlight = (id: string, chapterTitle: string | null, createdAt: string): Highlight => ({
  id,
  anchor: { kind: "epub", cfi: `epubcfi(/6/${id})` },
  quote: `quote ${id}`,
  chapterTitle,
  color: "amber",
  createdAt,
});
const note = (id: string, chapterTitle: string | null, createdAt: string, highlightId: string | null, body = `note ${id}`): Note => ({
  ...highlight(id, chapterTitle, createdAt),
  highlightId,
  body,
  tags: [],
  updatedAt: createdAt,
});

describe("latest marks in a chapter", () => {
  it("takes the newest three in the chapter, highlights and notes together", () => {
    const marks = recentMarks(
      [highlight("1", "One", "2026-01-01"), highlight("2", "One", "2026-01-04"), highlight("3", "Two", "2026-01-09"), highlight("4", "One", "2026-01-02")],
      [note("5", "One", "2026-01-03", null)],
      "One",
    );
    expect(marks.map((m) => [m.id, m.kind])).toEqual([["2", "highlight"], ["5", "note"], ["4", "highlight"]]);
  });

  it("shows a highlighted note once, as the note", () => {
    const marks = recentMarks([highlight("h", "One", "2026-01-01")], [note("n", "One", "2026-01-02", "h", "my thought")], "One");
    expect(marks).toEqual([{ id: "n", kind: "note", text: "my thought", createdAt: "2026-01-02" }]);
  });

  it("falls back to the quote for an empty note, and finds nothing for an unknown chapter", () => {
    expect(recentMarks([], [note("n", "One", "2026-01-02", null, "  ")], "One")[0].text).toBe("quote n");
    expect(recentMarks([highlight("1", "One", "2026-01-01")], [], null)).toEqual([]);
  });
});

describe("the excerpt before the reader's place", () => {
  it("keeps a short text whole and cuts a long one on a whole word, with an ellipsis", () => {
    expect(tailExcerpt("A  short\n text.")).toBe("A short text.");
    const long = Array.from({ length: 80 }, (_, n) => `word${n}`).join(" ");
    const cut = tailExcerpt(long, 100);
    expect(cut.startsWith("…word")).toBe(true);
    expect(cut.endsWith("word79")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(101);
  });
});

describe("minutes left in a chapter", () => {
  it("counts words", () => {
    expect(countWords("  one two\nthree  ")).toBe(3);
    expect(countWords("")).toBe(0);
  });

  it("rounds up at 230 words a minute, and says one minute for the last stretch", () => {
    expect(minutesLeft(2300, 1)).toBe(10);
    expect(minutesLeft(2300, 0.5)).toBe(5);
    expect(minutesLeft(2300, 0.5001)).toBe(6);
    expect(minutesLeft(2300, 0.001)).toBe(1);
    expect(minutesLeft(2300, 0)).toBe(0);
  });

  it("is unknown without words or a usable fraction, and clamps the fraction", () => {
    expect(minutesLeft(0, 0.5)).toBeNull();
    expect(minutesLeft(500, Number.NaN)).toBeNull();
    expect(minutesLeft(460, 3)).toBe(2);
    expect(minutesLeft(460, -1)).toBe(0);
  });

  it("words the label", () => {
    expect(minutesLeftLabel(0)).toBe("End of chapter");
    expect(minutesLeftLabel(1)).toBe("About 1 min left in chapter");
    expect(minutesLeftLabel(7)).toBe("About 7 min left in chapter");
  });
});
