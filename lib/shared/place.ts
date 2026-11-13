import type { Anchor, Position } from "./types";

/**
 * Where a passage sits, for display and for the tutor: the chapter, and for a
 * PDF the page. Chapter titles are stored without the page, so passages group
 * by chapter.
 */
export const placeLabel = (chapterTitle: string | null, place: Anchor | Position): string | null => {
  if (place.kind !== "pdf") return chapterTitle;
  const page = `p. ${place.page}`;
  if (!chapterTitle) return page;
  /* Threads saved before chapter and page were stored apart already end in the page. */
  return chapterTitle.endsWith(page) ? chapterTitle : `${chapterTitle}, ${page}`;
};

/** A reading position as an anchor to jump back to. A PDF anchor marks the top of the page. */
export const anchorAt = (position: Position): Anchor =>
  position.kind === "epub" ? { kind: "epub", cfi: position.cfi } : { kind: "pdf", page: position.page, start: 0, end: 0 };
