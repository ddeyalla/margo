import { compareCfi } from "./cfi";
import type { Anchor } from "./types";

/** Reading order: page then character for a PDF, CFI order for an EPUB. */
export const compareAnchors = (a: Anchor, b: Anchor): number => {
  if (a.kind === "pdf" && b.kind === "pdf") return a.page - b.page || a.start - b.start;
  if (a.kind === "epub" && b.kind === "epub") return compareCfi(a.cfi, b.cfi);
  return 0;
};

export const sameAnchor = (a: Anchor, b: Anchor): boolean =>
  a.kind === "pdf" && b.kind === "pdf"
    ? a.page === b.page && a.start === b.start && a.end === b.end
    : a.kind === "epub" && b.kind === "epub" && a.cfi === b.cfi;

interface Placed {
  anchor: Anchor;
  chapterTitle: string | null;
  createdAt: string;
}

export interface ChapterGroup<T> {
  /** Null for passages outside any chapter the book names. */
  title: string | null;
  items: T[];
}

/**
 * Items in reading order, split into runs that share a chapter. Runs, not one
 * bucket per title: a PDF outline repeats titles such as "Problem" under
 * every pattern, and those are different sections.
 */
export const byChapter = <T extends Placed>(items: T[]): ChapterGroup<T>[] => {
  const groups: ChapterGroup<T>[] = [];
  const ordered = [...items].sort((a, b) => compareAnchors(a.anchor, b.anchor) || a.createdAt.localeCompare(b.createdAt));
  for (const item of ordered) {
    const last = groups.at(-1);
    if (last && last.title === item.chapterTitle) last.items.push(item);
    else groups.push({ title: item.chapterTitle, items: [item] });
  }
  return groups;
};

export const UNTITLED_SECTION = "Untitled section";
