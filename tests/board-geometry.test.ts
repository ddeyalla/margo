import { describe, expect, it } from "vitest";
import { arrowBetween, besideOffset, boundsOf, NODE, placeNodes } from "@/components/board/geometry";
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

  it("moves a converted diagram to the right of the board, tops aligned", () => {
    const drawing = { x: 50, y: 70, width: 100, height: 100 };
    expect(besideOffset({ x: 0, y: 0, width: 400, height: 300 }, drawing)).toEqual({ dx: 400 + 160 - 50, dy: -70 });
    expect(besideOffset(null, drawing)).toEqual({ dx: -50, dy: -70 });
    expect(besideOffset(null, null)).toEqual({ dx: 0, dy: 0 });
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

  it("has no chapter off the table of contents", () => {
    expect(boardChapter(toc, -1, [])).toBeNull();
    expect(boardChapter(toc, 5, [])).toBeNull();
  });
});
