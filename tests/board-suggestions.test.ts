import { describe, expect, it, vi } from "vitest";

/* Excalidraw doesn't load under vitest, so its element helpers are stood in for: text measures 10px a character. */
vi.mock("@excalidraw/excalidraw", () => ({
  newElementWith: (element: object, updates: object) => ({ ...element, ...updates }),
  getCommonBounds: ([e]: { x: number; y: number; width: number; height: number }[]) => [e.x, e.y, e.x + e.width, e.y + e.height],
  convertToExcalidrawElements: (skeletons: { type: string; text?: string; label?: { text: string } }[]) =>
    skeletons.flatMap((s, i) => {
      const id = (s as { id?: string }).id ?? `made${i}`;
      const lines = (s.text ?? "").split("\n");
      const own = { ...s, id, width: Math.max(...lines.map((l) => l.length * 10)), height: lines.length * 25, isDeleted: false, boundElements: null };
      return s.label ? [{ ...own, width: (s as { width?: number }).width }, { type: "text", id: `${id}-label`, text: s.label.text, containerId: id }] : [own];
    }),
}));

const { acceptSuggestion, suggestionsFor } = await import("@/components/board/suggestions");

const text = {
  id: "cue",
  type: "text",
  x: 100,
  y: 0,
  width: 30,
  height: 25,
  text: "Cue",
  originalText: "Cue",
  fontSize: 20,
  fontFamily: 5,
  lineHeight: 1.25,
  textAlign: "left",
  autoResize: true,
  containerId: null,
  isDeleted: false,
  strokeColor: "#e03131",
  boundElements: [{ id: "arrow1", type: "arrow" }],
} as never;

describe("board suggestions", () => {
  it("rewords standalone text in place, keeping its id, its arrows and its colour", () => {
    const { added } = suggestionsFor([{ op: "update", id: "n1", text: "Trigger" }], { n1: "cue" }, [text]);
    const suggestion = (added[0].customData as { suggestion: string }).suggestion;
    const next = acceptSuggestion([text, ...added], suggestion);
    const cue = next.find((element) => element.id === "cue")!;
    expect(cue).toMatchObject({ isDeleted: false, text: "Trigger", originalText: "Trigger", width: 70, x: 100, strokeColor: "#e03131", boundElements: [{ id: "arrow1", type: "arrow" }] });
    expect(next.filter((element) => !element.isDeleted && element.type === "text")).toHaveLength(1);
  });

  it("wraps reworded text the reader gave a fixed width", () => {
    const fixed = { ...(text as object), autoResize: false, width: 80 } as never;
    const { added } = suggestionsFor([{ op: "update", id: "n1", text: "one two three" }], { n1: "cue" }, [fixed]);
    const next = acceptSuggestion([fixed, ...added], (added[0].customData as { suggestion: string }).suggestion);
    expect(next.find((element) => element.id === "cue")).toMatchObject({ text: "one two\nthree", originalText: "one two three", width: 80, height: 50 });
  });

  it("keeps the one coordinate the tutor gave for a new idea", () => {
    const { added } = suggestionsFor([{ op: "add_node", id: "a", text: "Reward", x: 500 }], {}, [text]);
    const box = added.find((element) => element.type === "rectangle")!;
    expect(box.x).toBe(500);
    expect(box.y).toBe(0);
  });
});
