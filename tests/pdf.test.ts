import { describe, expect, it } from "vitest";
import { chapterAt, destinationTop, locateOffset, type OutlineEntry } from "@/components/reader/pdf";
import { mergeLineBoxes } from "@/components/reader/rects";
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

describe("PDF highlight offsets", () => {
  /* "Hello" "\n" "" "world" → pieces of length 5, 1, 0, 5: "Hello\nworld". */
  const lengths = [5, 1, 0, 5];

  it("finds where a start offset begins", () => {
    expect(locateOffset(lengths, 0, "start")).toEqual({ piece: 0, offset: 0 });
    expect(locateOffset(lengths, 3, "start")).toEqual({ piece: 0, offset: 3 });
    expect(locateOffset(lengths, 5, "start")).toEqual({ piece: 1, offset: 0 });
    expect(locateOffset(lengths, 6, "start")).toEqual({ piece: 3, offset: 0 });
    expect(locateOffset(lengths, 11, "start")).toBeNull();
  });

  it("finds where an end offset closes, round-tripping with the page text", () => {
    expect(locateOffset(lengths, 5, "end")).toEqual({ piece: 0, offset: 5 });
    expect(locateOffset(lengths, 6, "end")).toEqual({ piece: 1, offset: 1 });
    expect(locateOffset(lengths, 8, "end")).toEqual({ piece: 3, offset: 2 });
    expect(locateOffset(lengths, 11, "end")).toEqual({ piece: 3, offset: 5 });
    expect(locateOffset(lengths, 0, "end")).toBeNull();

    const text = "Hello\nworld";
    const pieces = ["Hello", "\n", "", "world"];
    const slice = (start: number, end: number) => {
      const from = locateOffset(lengths, start, "start")!;
      const to = locateOffset(lengths, end, "end")!;
      return pieces
        .map((piece, i) => (i < from.piece || i > to.piece ? "" : piece.slice(i === from.piece ? from.offset : 0, i === to.piece ? to.offset : undefined)))
        .join("");
    };
    expect(slice(3, 8)).toBe(text.slice(3, 8));
    expect(slice(0, 11)).toBe(text);
  });
});

describe("highlight boxes", () => {
  it("joins touching boxes on a line and keeps lines apart", () => {
    const boxes = mergeLineBoxes([
      { left: 10, top: 100, width: 50, height: 12 },
      { left: 58, top: 101, width: 40, height: 11 },
      { left: 104, top: 100, width: 30, height: 12 },
      { left: 10, top: 116, width: 80, height: 12 },
      { left: 0, top: 0, width: 0, height: 12 },
    ]);
    expect(boxes).toEqual([
      { left: 10, top: 100, width: 124, height: 12 },
      { left: 10, top: 116, width: 80, height: 12 },
    ]);
  });

  it("reads rects whose fields are getters, as a range's client rects are", () => {
    class Rect {
      constructor(
        private readonly box: { left: number; top: number; width: number; height: number },
      ) {}
      get left() {
        return this.box.left;
      }
      get top() {
        return this.box.top;
      }
      get width() {
        return this.box.width;
      }
      get height() {
        return this.box.height;
      }
    }
    expect(mergeLineBoxes([new Rect({ left: 10, top: 100, width: 50, height: 12 })])).toEqual([
      { left: 10, top: 100, width: 50, height: 12 },
    ]);
  });

  it("keeps two columns on the same line apart", () => {
    expect(
      mergeLineBoxes([
        { left: 10, top: 100, width: 200, height: 12 },
        { left: 320, top: 100, width: 200, height: 12 },
      ]),
    ).toHaveLength(2);
  });
});
