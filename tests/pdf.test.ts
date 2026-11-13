import { describe, expect, it } from "vitest";
import { chapterAt, destinationTop, type OutlineEntry } from "@/components/reader/pdf";
import { placeLabel } from "@/lib/shared/place";

describe("PDF chapter lookup", () => {
  const outline: OutlineEntry[] = [
    { page: 1, top: 0, title: "Preface" },
    { page: 12, top: 0.1, title: "Chapter 1" },
    { page: 12, top: 0.55, title: "Chapter 2" },
    { page: 30, top: 0.2, title: "Chapter 3" },
  ];

  it("picks the entry at or above the point on its page", () => {
    expect(chapterAt(outline, 12, 0.3)).toBe("Chapter 1");
    expect(chapterAt(outline, 12, 0.7)).toBe("Chapter 2");
    expect(chapterAt(outline, 12, 0.54)).toBe("Chapter 2");
    expect(chapterAt(outline, 12, 0.05)).toBe("Preface");
  });

  it("carries a chapter across the pages that follow it", () => {
    expect(chapterAt(outline, 20, 0)).toBe("Chapter 2");
    expect(chapterAt(outline, 30, 0.1)).toBe("Chapter 2");
    expect(chapterAt(outline, 31, 0)).toBe("Chapter 3");
  });

  it("has no chapter before the first entry or without an outline", () => {
    expect(chapterAt([{ page: 3, top: 0, title: "One" }], 2, 0.5)).toBeNull();
    expect(chapterAt([], 5, 0.5)).toBeNull();
  });

  it("reads the top of each destination kind", () => {
    const ref = { num: 4, gen: 0 };
    expect(destinationTop([ref, { name: "XYZ" }, 72, 700, null])).toBe(700);
    expect(destinationTop([ref, { name: "XYZ" }, 72, null, null])).toBeNull();
    expect(destinationTop([ref, { name: "FitH" }, 640])).toBe(640);
    expect(destinationTop([ref, { name: "FitR" }, 10, 20, 300, 500])).toBe(500);
    expect(destinationTop([ref, { name: "Fit" }])).toBeNull();
    expect(destinationTop(null)).toBeNull();
  });
});

describe("place labels", () => {
  it("adds the page to a PDF chapter, and stands alone without one", () => {
    expect(placeLabel("Chapter 2", { kind: "pdf", page: 12, start: 0, end: 4 })).toBe("Chapter 2, p. 12");
    expect(placeLabel(null, { kind: "pdf", page: 12, start: 0, end: 4 })).toBe("p. 12");
    expect(placeLabel("Intro", { kind: "epub", cfi: "epubcfi(/6/2)" })).toBe("Intro");
    expect(placeLabel(null, { kind: "epub", cfi: "epubcfi(/6/2)" })).toBeNull();
  });

  it("does not repeat the page on a label saved with it", () => {
    expect(placeLabel("Chapter 2, p. 12", { kind: "pdf", page: 12, start: 0, end: 4 })).toBe("Chapter 2, p. 12");
  });
});
