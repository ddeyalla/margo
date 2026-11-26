import { describe, expect, it } from "vitest";
import { anchoredX, arrowBetween, besideOffset, boundsOf, boundTextMaxWidth, containerWidthFor, followWidened, NODE, placeNodes, textRepairs, wrapWords } from "@/components/board/geometry";
import { boardChapter } from "@/lib/shared/boards";

describe("board geometry", () => {
  it("bounds boxes, or nothing for none", () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([{ x: 0, y: 10, width: 50, height: 20 }, { x: -20, y: 0, width: 10, height: 10 }])).toEqual({ x: -20, y: 0, width: 70, height: 30 });
  });

  it("draws an arrow from edge to edge, a gap off each box", () => {
    const arrow = arrowBetween({ x: 0, y: 0, width: 100, height: 50 }, { x: 300, y: 0, width: 100, height: 50 }, 6);
    expect(arrow.x).toBeCloseTo(106);
    expect(arrow.y).toBeCloseTo(25);
    expect(arrow.points[0]).toEqual([0, 0]);
    expect(arrow.points[1][0]).toBeCloseTo(188);
    expect(arrow.points[1][1]).toBeCloseTo(0);
  });

  it("places a linked idea beside its partner, stacking a second one below it", () => {
    const near = { x: 0, y: 0, width: 180, height: 64 };
    const placed = placeNodes([{ id: "a", near }, { id: "b", near }], near);
    expect(placed.get("a")).toEqual({ x: 300, y: 0 });
    expect(placed.get("b")).toEqual({ x: 300, y: NODE.height + 40 });
  });

  it("places an unlinked idea in a column right of the board, or at the origin on an empty one", () => {
    const board = { x: 10, y: 20, width: 200, height: 100 };
    expect(placeNodes([{ id: "a", near: null }, { id: "b", near: null }], board)).toEqual(
      new Map([
        ["a", { x: 330, y: 20 }],
        ["b", { x: 330, y: 20 + NODE.height + 40 }],
      ]),
    );
    expect(placeNodes([{ id: "a", near: null }], null).get("a")).toEqual({ x: 0, y: 0 });
  });

  it("stacks ideas beside the same element by its id, not by which box object stands for it", () => {
    const placed = placeNodes(
      [
        { id: "a", near: { x: 0, y: 0, width: 180, height: 64 }, key: "cue" },
        { id: "b", near: { x: 0, y: 0, width: 180, height: 64 }, key: "cue" },
      ],
      null,
    );
    expect(placed.get("b")).toEqual({ x: 300, y: NODE.height + 40 });
  });

  it("stacks equal boxes without a key by where they are", () => {
    const placed = placeNodes([{ id: "a", near: { x: 0, y: 0, width: 180, height: 64 } }, { id: "b", near: { x: 0, y: 0, width: 180, height: 64 } }], null);
    expect(placed.get("b")).toEqual({ x: 300, y: NODE.height + 40 });
  });

  it("leaves room for a tall idea before the next, beside an element and in the column", () => {
    const near = { x: 0, y: 0, width: 180, height: 64 };
    const tall = { width: 320, height: 145 };
    const beside = placeNodes([{ id: "a", near, key: "n", size: tall }, { id: "b", near, key: "n" }], null);
    expect(beside.get("b")).toEqual({ x: 300, y: 145 + 40 });
    const column = placeNodes([{ id: "a", near: null, size: tall }, { id: "b", near: null }], null);
    expect(column.get("b")).toEqual({ x: 0, y: 145 + 40 });
  });

  it("moves a converted diagram to the right of the board, tops aligned", () => {
    const drawing = { x: 50, y: 70, width: 100, height: 100 };
    expect(besideOffset({ x: 0, y: 0, width: 400, height: 300 }, drawing)).toEqual({ dx: 400 + 160 - 50, dy: -70 });
    expect(besideOffset(null, drawing)).toEqual({ dx: -50, dy: -70 });
    expect(besideOffset(null, null)).toEqual({ dx: 0, dy: 0 });
  });
});

describe("fitting text", () => {
  const measure = (line: string) => line.length * 10;

  it("sizes labels as Excalidraw does for each kind of shape", () => {
    expect(boundTextMaxWidth("rectangle", 200, 20)).toBe(190);
    expect(boundTextMaxWidth("diamond", 200, 20)).toBe(90);
    expect(boundTextMaxWidth("ellipse", 200, 20)).toBe(131);
    expect(boundTextMaxWidth("arrow", 100, 20)).toBe(220);
    expect(containerWidthFor("rectangle", 100)).toBe(110);
    expect(containerWidthFor("diamond", 100)).toBe(220);
    for (const type of ["rectangle", "diamond", "ellipse"]) expect(boundTextMaxWidth(type, containerWidthFor(type, 100), 20)).toBeGreaterThanOrEqual(99);
  });

  it("keeps text anchored by its alignment as it widens", () => {
    expect(anchoredX(100, 50, 80, "left")).toBe(100);
    expect(anchoredX(100, 50, 80, "center")).toBe(85);
    expect(anchoredX(100, 50, 80, "right")).toBe(70);
  });

  it("wraps words to a width, keeping the lines already there", () => {
    expect(wrapWords("one two three\nfour", 80, measure)).toBe("one two\nthree\nfour");
  });

  it("breaks a word wider than a whole line between its characters", () => {
    const wide = (line: string) => line.length * 10;
    expect(wrapWords("unbreakable", 30, wide)).toBe("unb\nrea\nkab\nle");
    expect(wrapWords("go unbreakable", 30, wide)).toBe("go\nunb\nrea\nkab\nle");
    expect(wrapWords("a", 5, wide)).toBe("a");
  });

  it("keeps an arrow's bound ends on a shape that widened around its center", () => {
    const shapes = new Map([["box", { x: 0, width: 100 }]]);
    const repairs = new Map([["box", { x: -20, width: 140 }]]);
    const arrow = (start: string | null, end: string | null, x: number, points: [number, number][]) => ({
      id: "a", isDeleted: false, x, points, startBinding: start ? { elementId: start } : null, endBinding: end ? { elementId: end } : null,
    });
    /* Leaving the right edge, at x 106: the edge moved out 20, so the start does too, and the far end stays. */
    expect(followWidened([arrow("box", null, 106, [[0, 0], [100, 0]])], shapes, repairs).get("a")).toEqual({ x: 128.4, points: [[0, 0], [77.6, 0]], width: 77.6 });
    /* Arriving at the left edge, at x -6. */
    expect(followWidened([arrow(null, "box", -106, [[0, 0], [100, 0]])], shapes, repairs).get("a")).toEqual({ x: -106, points: [[0, 0], [77.6, 0]], width: 77.6 });
    expect(followWidened([arrow("other", null, 0, [[0, 0], [10, 0]])], shapes, repairs).size).toBe(0);
  });

  const text = { id: "t", isDeleted: false, x: 0, width: 50, fontSize: 20, textAlign: "center", containerId: null as string | null, measured: 80 };

  it("leaves text that already fits alone", () => {
    expect(textRepairs([{ ...text, measured: 50.3 }], new Map()).size).toBe(0);
  });

  it("widens free text around its alignment", () => {
    expect(textRepairs([{ ...text, x: 100, textAlign: "right" }], new Map()).get("t")).toEqual({ x: 70, width: 80 });
  });

  it("never resizes an arrow, and keeps its label centered on it", () => {
    const arrow = { id: "a", isDeleted: false, type: "arrow", x: 100, width: 0 };
    const repairs = textRepairs([{ ...text, x: 75, containerId: "a", measured: 100 }], new Map([["a", arrow]]));
    expect(repairs.has("a")).toBe(false);
    expect(repairs.get("t")).toEqual({ x: 50, width: 100 });
  });

  it("widens a shape around its center as Excalidraw would size it, and aligns the label inside", () => {
    const diamond = { id: "d", isDeleted: false, type: "diamond", x: 0, width: 200 };
    const repairs = textRepairs([{ ...text, containerId: "d", measured: 120, textAlign: "left" }], new Map([["d", diamond]]));
    expect(repairs.get("d")).toEqual({ x: -30, width: 260 });
    expect(repairs.get("t")).toEqual({ x: -30 + 5 + 65, width: 120 });
  });

  it("keeps a shape whose label still fits, moving only the label", () => {
    const box = { id: "r", isDeleted: false, type: "rectangle", x: 0, width: 200 };
    const repairs = textRepairs([{ ...text, containerId: "r", measured: 120, textAlign: "right" }], new Map([["r", box]]));
    expect(repairs.has("r")).toBe(false);
    expect(repairs.get("t")).toEqual({ x: 5 + 190 - 120, width: 120 });
  });
});

describe("boardChapter", () => {
  const toc = [
    { label: "Part I", depth: 0 },
    { label: "1. Habits", depth: 1 },
    { label: "Cues", depth: 2 },
    { label: "2. Rewards", depth: 1 },
    { label: "Notes", depth: 0 },
  ];

  it("uses the course chapter the reader is in, with its sections", () => {
    expect(boardChapter(toc, 2, ["1. Habits", "2. Rewards"])).toEqual({ chapter: "1. Habits", labels: ["1. Habits", "Cues"] });
  });

  it("falls back to the top-level entry outside a course", () => {
    expect(boardChapter(toc, 2, [])).toEqual({ chapter: "Part I", labels: ["Part I", "1. Habits", "Cues", "2. Rewards"] });
    expect(boardChapter(toc, 4, [])).toEqual({ chapter: "Notes", labels: ["Notes"] });
  });

  it("tells a later chapter of the same title from the first", () => {
    const twice = [
      { label: "Introduction", depth: 0 },
      { label: "Why", depth: 1 },
      { label: "Part II", depth: 0 },
      { label: "Introduction", depth: 0 },
      { label: "How", depth: 1 },
    ];
    expect(boardChapter(twice, 1, [])).toEqual({ chapter: "Introduction", labels: ["Introduction", "Why"] });
    expect(boardChapter(twice, 4, [])).toEqual({ chapter: "Introduction", labels: ["Introduction", "How"], occurrence: 1 });
  });

  it("has no chapter off the table of contents", () => {
    expect(boardChapter(toc, -1, [])).toBeNull();
    expect(boardChapter(toc, 5, [])).toBeNull();
  });
});
