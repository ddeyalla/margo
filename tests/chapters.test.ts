import { describe, expect, it } from "vitest";
import { byChapter, newestFirst } from "@/lib/shared/annotations";
import type { Anchor } from "@/lib/shared/types";

const item = (id: string, page: number, chapterTitle: string | null, createdAt: string) => ({
  id,
  anchor: { kind: "pdf", page, start: 0, end: 10 } as Anchor,
  chapterTitle,
  createdAt,
});

const shape = (groups: { title: string | null; items: { id: string }[] }[]) => groups.map((g) => [g.title, g.items.map((i) => i.id)]);

describe("chapter sections", () => {
  const items = [
    item("old-p1", 1, "One", "2026-11-01T00:00:00.000Z"),
    item("new-p2", 2, "One", "2026-11-09T00:00:00.000Z"),
    item("mid-p3", 3, "One", "2026-11-05T00:00:00.000Z"),
    item("loose", 4, null, "2026-11-02T00:00:00.000Z"),
    item("two", 5, "Two", "2026-11-03T00:00:00.000Z"),
  ];

  it("keeps reading order inside each chapter by default", () => {
    expect(shape(byChapter([...items].reverse()))).toEqual([
      ["One", ["old-p1", "new-p2", "mid-p3"]],
      [null, ["loose"]],
      ["Two", ["two"]],
    ]);
  });

  it("reorders within chapters without moving items between them", () => {
    expect(shape(byChapter(items, newestFirst))).toEqual([
      ["One", ["new-p2", "mid-p3", "old-p1"]],
      [null, ["loose"]],
      ["Two", ["two"]],
    ]);
  });

  it("breaks a newest-first tie by reading order", () => {
    const same = "2026-11-04T00:00:00.000Z";
    expect(shape(byChapter([item("b", 2, "One", same), item("a", 1, "One", same)], newestFirst))).toEqual([["One", ["a", "b"]]]);
  });

  it("leaves the caller's array as it was", () => {
    const input = [...items].reverse();
    const before = input.map((i) => i.id);
    byChapter(input, newestFirst);
    expect(input.map((i) => i.id)).toEqual(before);
  });
});
