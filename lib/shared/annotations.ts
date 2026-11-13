import { compareCfi } from "./cfi";
import { parseTags } from "./tags";
import type { Anchor, Annotations, Highlight, Note } from "./types";

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

/** The passage a highlight or note marks. Ids are made in the browser, so sending a change twice is harmless. */
export interface Passage {
  id: string;
  anchor: Anchor;
  quote: string;
  chapterTitle: string | null;
}

/** Every change to a book's highlights and notes. The browser applies it at once and the server applies it again on save. */
export type AnnotationChange =
  | { op: "add-highlight"; highlight: Passage }
  | { op: "remove-highlight"; id: string }
  /** `highlightId` names the highlight to create when the passage has none yet. */
  | { op: "add-note"; note: Passage & { body: string }; highlightId: string }
  | { op: "edit-note"; id: string; body: string }
  | { op: "remove-note"; id: string };

/** The HTTP method each change travels with. */
export const CHANGE_METHODS = {
  "add-highlight": "POST",
  "add-note": "POST",
  "edit-note": "PATCH",
  "remove-highlight": "DELETE",
  "remove-note": "DELETE",
} as const satisfies Record<AnnotationChange["op"], string>;

export type AnnotationMethod = (typeof CHANGE_METHODS)[AnnotationChange["op"]];

/**
 * Applies one change. Each converges: adding an id that exists, or removing
 * one that doesn't, leaves the state as it is. A note always marks its
 * passage, reusing a highlight on the same passage or creating one. Removing a
 * highlight keeps its notes; they lose the link and keep their own quote.
 */
export const applyChange = (state: Annotations, change: AnnotationChange, now: string): Annotations => {
  switch (change.op) {
    case "add-highlight": {
      if (state.highlights.some((h) => h.id === change.highlight.id)) return state;
      const highlight: Highlight = { ...change.highlight, color: "amber", createdAt: now };
      return { ...state, highlights: [...state.highlights, highlight] };
    }
    case "remove-highlight":
      return {
        ...state,
        highlights: state.highlights.filter((h) => h.id !== change.id),
        notes: state.notes.map((n) => (n.highlightId === change.id ? { ...n, highlightId: null } : n)),
      };
    case "add-note": {
      if (state.notes.some((n) => n.id === change.note.id)) return state;
      const { body, ...passage } = change.note;
      const existing = state.highlights.find((h) => sameAnchor(h.anchor, passage.anchor));
      const highlight: Highlight = existing ?? { ...passage, id: change.highlightId, color: "amber", createdAt: now };
      const note: Note = { ...passage, highlightId: highlight.id, body, tags: parseTags(body), createdAt: now, updatedAt: now };
      return {
        ...state,
        highlights: existing ? state.highlights : [...state.highlights, highlight],
        notes: [...state.notes, note],
      };
    }
    case "edit-note":
      return {
        ...state,
        notes: state.notes.map((n) =>
          n.id === change.id ? { ...n, body: change.body, tags: parseTags(change.body), updatedAt: now } : n,
        ),
      };
    case "remove-note":
      return { ...state, notes: state.notes.filter((n) => n.id !== change.id) };
  }
};

