import type { PDFDocumentProxy } from "pdfjs-dist";
import { describe, expect, it } from "vitest";
import { readOutline } from "@/components/reader/pdf";
import { epubToc, wholeChapterSections, type FoliateTocItem } from "@/components/reader/toc";

describe("EPUB table of contents", () => {
  const toc: FoliateTocItem[] = [
    { label: "Cover", href: "cover.xhtml" },
    {
      label: "Part I\n   Foundations",
      href: "part1.xhtml",
      subitems: [
        { label: "1. Evals", href: "ch01.xhtml", subitems: [{ label: "What to measure", href: "ch01.xhtml#measure" }] },
        { label: "2. Error analysis", href: "ch02.xhtml" },
      ],
    },
    { label: "Part II", href: null, subitems: [{ label: "3. Judges", href: "ch03.xhtml" }] },
    { label: "  ", href: "blank.xhtml" },
  ];

  it("flattens the nesting in reading order, with each entry's depth", () => {
    expect([...epubToc(toc).values()]).toEqual([
      { label: "Cover", depth: 0, target: { kind: "epub", href: "cover.xhtml" } },
      { label: "Part I Foundations", depth: 0, target: { kind: "epub", href: "part1.xhtml" } },
      { label: "1. Evals", depth: 1, target: { kind: "epub", href: "ch01.xhtml" } },
      { label: "What to measure", depth: 2, target: { kind: "epub", href: "ch01.xhtml#measure" } },
      { label: "2. Error analysis", depth: 1, target: { kind: "epub", href: "ch02.xhtml" } },
      { label: "3. Judges", depth: 1, target: { kind: "epub", href: "ch03.xhtml" } },
    ]);
  });

  it("finds the entry for the item foliate reports", () => {
    const chapter = toc[1].subitems![1];
    expect(epubToc(toc).get(chapter)?.label).toBe("2. Error analysis");
  });

  it("is empty for a book with no usable contents", () => {
    expect(epubToc(null).size).toBe(0);
    expect(epubToc([]).size).toBe(0);
  });
});

describe("PDF outline", () => {
  type Item = { title: string; dest: unknown; items?: Item[] };
  const ref = (num: number) => ({ num, gen: 0 });
  /* A page is 800 units tall; pdf.js measures y up from the bottom, the viewport down from the top. */
  const fakeDoc = (outline: Item[] | null, named: Record<string, unknown> = {}) =>
    ({
      getOutline: async () => outline,
      getDestination: async (name: string) => named[name] ?? null,
      getPageIndex: async (pageRef: { num: number }) => pageRef.num - 1,
      getPage: async () => ({
        getViewport: () => ({ height: 800, convertToViewportPoint: (_x: number, y: number) => [0, 800 - y] }),
      }),
    }) as unknown as PDFDocumentProxy;

  it("keeps the outline's order and depth, and places each entry on its page", async () => {
    const doc = fakeDoc(
      [
        { title: "Preface", dest: [ref(3), { name: "Fit" }] },
        {
          title: "Chapter 1",
          dest: "ch1",
          items: [{ title: " Evals\nin practice ", dest: [ref(14), { name: "XYZ" }, 0, 400, null] }],
        },
        { title: "Broken", dest: "missing", items: [{ title: "Survivor", dest: [2, { name: "Fit" }] }] },
      ],
      { ch1: [ref(12), { name: "XYZ" }, 0, 720, null] },
    );
    expect(await readOutline(doc)).toEqual([
      { label: "Preface", depth: 0, target: { kind: "pdf", page: 3, top: 0 } },
      { label: "Chapter 1", depth: 0, target: { kind: "pdf", page: 12, top: 0.1 } },
      { label: "Evals in practice", depth: 1, target: { kind: "pdf", page: 14, top: 0.5 } },
      { label: "Survivor", depth: 1, target: { kind: "pdf", page: 3, top: 0 } },
    ]);
  });

  it("is empty for a PDF without an outline", async () => {
    expect(await readOutline(fakeDoc(null))).toEqual([]);
  });
});

describe("sections that are one whole chapter", () => {
  const linear = (count: number) => Array.from({ length: count }, () => true);

  it("counts a chapter file with its own sub-entries, but not a part that spans later files", () => {
    /* Part I in section 1, chapters 1 and 2 in sections 2 and 3, Part II in section 4. */
    const entries = [
      { depth: 0, section: 1 },
      { depth: 1, section: 2 },
      { depth: 2, section: 2 },
      { depth: 2, section: 2 },
      { depth: 1, section: 3 },
      { depth: 0, section: 4 },
    ];
    expect([...wholeChapterSections(entries, linear(5))].sort()).toEqual([2, 3, 4]);
  });

  it("leaves out a chapter that runs on into a file with no entry of its own", () => {
    const entries = [
      { depth: 0, section: 0 },
      { depth: 0, section: 2 },
    ];
    expect([...wholeChapterSections(entries, linear(3))]).toEqual([2]);
  });

  it("leaves out a file that holds two chapters", () => {
    const entries = [
      { depth: 0, section: 0 },
      { depth: 0, section: 0 },
      { depth: 0, section: 1 },
    ];
    expect([...wholeChapterSections(entries, linear(2))]).toEqual([1]);
  });

  it("skips sections outside the reading order when finding the next one", () => {
    const entries = [
      { depth: 0, section: 0 },
      { depth: 0, section: 2 },
    ];
    expect([...wholeChapterSections(entries, [true, false, true])].sort()).toEqual([0, 2]);
  });
});
