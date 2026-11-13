import { describe, expect, it } from "vitest";
import { normalizeText, trimAfter, trimBefore } from "@/lib/shared/context";

const words = (count: number, word = "word") => Array.from({ length: count }, (_, n) => `${word}${n}`).join(" ");

describe("normalizeText", () => {
  it("collapses spaces and keeps one blank line between paragraphs", () => {
    expect(normalizeText("  One  two\t three.\n\n\n\n  Next   para­graph.  ")).toBe("One two three.\n\nNext paragraph.");
  });
});

describe("trimBefore", () => {
  it("keeps short text whole", () => {
    expect(trimBefore("A short   lead-in.")).toBe("A short lead-in.");
  });

  it("keeps the end of long text and starts on a whole word", () => {
    const text = words(1000);
    const trimmed = trimBefore(text, 100);
    expect(trimmed.length).toBeLessThanOrEqual(100);
    expect(text.endsWith(trimmed)).toBe(true);
    expect(trimmed.startsWith("word")).toBe(true);
    expect(trimmed.endsWith("word999")).toBe(true);
  });
});

describe("trimAfter", () => {
  it("keeps the start of long text and ends on a whole word", () => {
    const text = words(1000);
    const trimmed = trimAfter(text, 100);
    expect(trimmed.length).toBeLessThanOrEqual(100);
    expect(text.startsWith(trimmed)).toBe(true);
    expect(text.charAt(trimmed.length)).toBe(" ");
  });

  it("cuts inside a word only when no break is near the limit", () => {
    expect(trimAfter("x".repeat(500), 100)).toBe("x".repeat(100));
  });
});
