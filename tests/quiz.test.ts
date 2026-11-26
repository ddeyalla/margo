import { describe, expect, it } from "vitest";
import { chapterBlocks, fitBlocks, quizRequest } from "@/lib/server/quiz/generate";
import {
  chapterOf,
  chapterSpan,
  leftChapter,
  parseQuizReply,
  passMark,
  stepKey,
  stepStates,
} from "@/lib/shared/quiz";
import type { Anchor, BookId } from "@/lib/shared/types";

const anchor = { kind: "epub", cfi: "epubcfi(/6/2!/4/2)" } as unknown as Anchor;

describe("passMark", () => {
  it("asks for 80 % rounded up", () => {
    expect([5, 6, 7, 8].map(passMark)).toEqual([4, 5, 6, 7]);
    expect(passMark(10)).toBe(8);
  });
});

const toc = [
  { label: "Intro", depth: 0 },
  { label: "Part One", depth: 0 },
  { label: "Chapter 1", depth: 1 },
  { label: "Section 1.1", depth: 2 },
  { label: "Chapter 2", depth: 1 },
  { label: "Part Two", depth: 0 },
];

describe("chapterSpan", () => {
  it("holds the entry and what nests under it", () => {
    expect(chapterSpan(toc, "Chapter 1")).toEqual({ start: 2, end: 4, labels: ["Chapter 1", "Section 1.1"] });
    expect(chapterSpan(toc, "Part One")).toEqual({ start: 1, end: 5, labels: ["Part One", "Chapter 1", "Section 1.1", "Chapter 2"] });
    expect(chapterSpan(toc, "Part Two")).toEqual({ start: 5, end: 6, labels: ["Part Two"] });
    expect(chapterSpan(toc, "Missing")).toBeNull();
  });
  it("is left once the reader is past every entry", () => {
    const span = chapterSpan(toc, "Chapter 1")!;
    expect(leftChapter(span, 3)).toBe(false);
    expect(leftChapter(span, 4)).toBe(true);
  });
  it("finds the innermost course chapter holding an entry", () => {
    expect(chapterOf(toc, 3, ["Part One", "Chapter 1"])).toBe("Chapter 1");
    expect(chapterOf(toc, 4, ["Part One", "Chapter 1"])).toBe("Part One");
    expect(chapterOf(toc, 0, ["Part One"])).toBeNull();
  });
});

describe("stepStates", () => {
  const a = "a" as BookId;
  const b = "b" as BookId;
  const steps = [
    { bookId: a, chapter: "One", unit: 0 },
    { bookId: a, chapter: "Two", unit: 0 },
    { bookId: b, chapter: "One", unit: 1 },
  ];
  it("never locks the first step and locks each after one not passed", () => {
    const states = stepStates(steps, new Set());
    expect(states.map((s) => s.locked)).toEqual([false, true, true]);
    expect(states[1].previous).toEqual(steps[0]);
  });
  it("unlocks a step once the one before is passed, across books", () => {
    const states = stepStates(steps, new Set([stepKey(a, "One"), stepKey(a, "Two")]));
    expect(states.map((s) => [s.passed, s.locked])).toEqual([
      [true, false],
      [true, false],
      [false, false],
    ]);
  });
});

describe("parseQuizReply", () => {
  const item = (kind: string, n: number, block = 1) => ({ kind, question: `Question ${n}?`, answer: `Answer ${n}.`, block });
  const reply = (items: unknown[]) => `Here you go:\n${JSON.stringify({ questions: items })}`;

  it("reads a good reply", () => {
    const draft = parseQuizReply(reply([item("why", 1), item("recall", 2, 3), item("recall", 3), item("recall", 4), item("why", 5)]), 3);
    expect(Array.isArray(draft) && draft.map((d) => d.block)).toEqual([1, 3, 1, 1, 1]);
  });
  it("asks for enough questions and a why", () => {
    expect(parseQuizReply(reply([item("why", 1), item("recall", 2)]), 3)).toMatch(/5 to 8/);
    expect(parseQuizReply(reply([1, 2, 3, 4, 5].map((n) => item("recall", n))), 3)).toMatch(/why/);
  });
  it("drops repeated questions and keeps at most eight", () => {
    const repeated = [item("why", 1), item("why", 1), item("recall", 2), item("recall", 3), item("recall", 4)];
    expect(parseQuizReply(reply(repeated), 3)).toMatch(/had 4/);
    const many = Array.from({ length: 11 }, (_, n) => item(n ? "recall" : "why", n));
    expect((parseQuizReply(reply(many), 3) as unknown[]).length).toBe(8);
  });
  it("rejects a block outside the chapter, a bad kind, and no JSON", () => {
    expect(parseQuizReply(reply([item("why", 1, 9), 2, 3, 4, 5].map((x) => (typeof x === "number" ? item("recall", x) : x))), 3)).toMatch(/block/);
    expect(parseQuizReply(reply([item("trivia", 1)]), 3)).toMatch(/kind/);
    expect(parseQuizReply("no json here", 3)).toMatch(/no JSON/);
  });
});

describe("chapter text for the quiz", () => {
  const block = (chapter: string | null, text: string) => ({ anchor, chapter, text });
  const text = { blocks: [block("Intro", "a"), block("Chapter 1", "b"), block("Section 1.1", "c"), block(null, "d"), block("Chapter 2", "e")] };

  it("takes the chapter's blocks and those nested under it", () => {
    expect(chapterBlocks(text as never, ["Chapter 1", "Section 1.1"]).map((b) => b.text)).toEqual(["b", "c"]);
  });
  it("thins a long chapter evenly, start to end", () => {
    const blocks = Array.from({ length: 100 }, (_, i) => ({ text: "x".repeat(100), i }));
    const kept = fitBlocks(blocks, 2_500);
    expect(kept.length).toBe(25);
    expect(kept[0].i).toBeLessThan(5);
    expect(kept.at(-1)!.i).toBeGreaterThan(94);
    expect(fitBlocks(blocks.slice(0, 3), 2_500)).toHaveLength(3);
  });
  it("numbers the blocks for the tutor", () => {
    const request = quizRequest({ title: "Book", author: "Someone" } as never, "Chapter 1", [{ text: "first" }, { text: "second" }]);
    expect(request).toContain("[1] first\n[2] second");
    expect(request).toContain("Book, by Someone");
  });
});
