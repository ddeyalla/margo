/* What the notes API sends: standalone notes are .md files in the notes folder, edited in place. */

export interface NoteFileInfo {
  /** Relative to the notes folder, "/"-separated, ".md" included. */
  path: string;
  title: string;
  /** ISO time the file last changed on disk. */
  modifiedAt: string;
}

/** A per-book file the app writes from its highlights; links to it work, editing it does not. */
export interface BookFileInfo {
  path: string;
  title: string;
  bookId: string;
}

export interface NotesIndex {
  notes: NoteFileInfo[];
  books: BookFileInfo[];
  /** Every #tag used in a note, for completion. */
  tags: string[];
}

export interface Backlink {
  path: string;
  title: string;
  /** The line the link is on, trimmed. */
  context: string;
}

export interface OpenedNote {
  path: string;
  text: string;
  /** The hash of the bytes read, sent back with a save so a file changed since is never overwritten. */
  hash: string;
  backlinks: Backlink[];
}

export type NoteSave =
  | { state: "saved"; hash: string }
  /** The file changed or was deleted on disk since it was opened: it was left alone and the text was kept in `copy`. */
  | { state: "conflict"; copy: string; copyHash: string; current: { text: string; hash: string } | null };

/** A highlight in a book's file, ready to embed with ![[target]]. */
export interface HighlightBlock {
  target: string;
  bookTitle: string;
  quote: string;
}

export interface Embed {
  path: string;
  text: string;
  /** Set when the block is a highlight in a book's file, so the embed can open the book. */
  bookId: string | null;
}

export const NOTE_MAX_CHARS = 1_000_000;
