import type { Highlight, Note } from "./types";

/** The reader has to have been away this long before the book greets them with where they left off. */
export const AWAY_MS = 30 * 60 * 1000;

/**
 * Whether to show "where you left off" on a fresh open: there is a saved place, and the reader was last
 * moving through the book at least `awayMs` ago. An unknown or future time never shows it.
 */
export const shouldShowResume = (hasPosition: boolean, lastReadAt: string | null, now: Date, awayMs = AWAY_MS): boolean => {
  if (!hasPosition || !lastReadAt) return false;
  const last = Date.parse(lastReadAt);
  if (!Number.isFinite(last)) return false;
  return now.getTime() - last >= awayMs;
};

/** One highlight or note the reader made in a chapter. */
export interface Mark {
  id: string;
  kind: "highlight" | "note";
  text: string;
  createdAt: string;
}

/**
 * The newest `limit` highlights and notes in a chapter. A highlight that carries a note shows once, as the
 * note's text.
 */
export const recentMarks = (highlights: Highlight[], notes: Note[], chapterTitle: string | null, limit = 3): Mark[] => {
  if (chapterTitle === null) return [];
  const noted = new Set(notes.map((note) => note.highlightId).filter((id): id is string => id !== null));
  const marks: Mark[] = [
    ...highlights.filter((h) => h.chapterTitle === chapterTitle && !noted.has(h.id)).map((h): Mark => ({ id: h.id, kind: "highlight", text: h.quote, createdAt: h.createdAt })),
    ...notes.filter((n) => n.chapterTitle === chapterTitle).map((n): Mark => ({ id: n.id, kind: "note", text: n.body.trim() || n.quote, createdAt: n.createdAt })),
  ];
  return marks.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
};

/** The end of `text`, at most `max` characters, starting on a whole word, with an ellipsis where it was cut. */
export const tailExcerpt = (text: string, max = 280): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(flat.length - max);
  const space = cut.indexOf(" ");
  return `…${space > -1 && space < 30 ? cut.slice(space + 1) : cut}`;
};
