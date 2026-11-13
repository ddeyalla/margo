import { sameAnchor } from "@/lib/shared/annotations";
import { normalizeText } from "@/lib/shared/context";
import { parseTags } from "@/lib/shared/tags";
import type { Anchor, Annotations, BookFormat, BookState, Highlight, LibraryBook, Note, VaultStatus } from "@/lib/shared/types";
import { readBookState, serialized, updateBookState } from "./store";
import { isObject, parseAnchor, shortText } from "./validate";
import { writeVault } from "./vault";

const MAX_QUOTE = 12_000;
const MAX_NOTE = 20_000;

/** The passage a highlight or note marks, as the browser sends it. Ids are made in the browser so a retry is harmless. */
interface Passage {
  id: string;
  anchor: Anchor;
  quote: string;
  chapterTitle: string | null;
}

/** Every change the annotations route accepts. */
export type AnnotationChange =
  | { op: "add-highlight"; highlight: Passage }
  | { op: "remove-highlight"; id: string }
  /** `highlightId` names the highlight to create when the passage has none yet. */
  | { op: "add-note"; note: Passage & { body: string }; highlightId: string }
  | { op: "edit-note"; id: string; body: string }
  | { op: "remove-note"; id: string };

export type AnnotationMethod = "POST" | "PATCH" | "DELETE";

const isId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const noteBody = (value: unknown): string | null => shortText(value, MAX_NOTE);

const parsePassage = (value: unknown, format: BookFormat): Passage | null => {
  if (!isObject(value) || !isId(value.id)) return null;
  const anchor = parseAnchor(value.anchor, format);
  const quote = shortText(value.quote, MAX_QUOTE * 2);
  if (!anchor || !quote) return null;
  return { id: value.id, anchor, quote: normalizeText(quote).slice(0, MAX_QUOTE), chapterTitle: shortText(value.chapterTitle, 500) };
};

/** POST creates, PATCH edits a note's body, DELETE removes. Anything else is refused with a reason. */
export const parseChange = (method: AnnotationMethod, body: unknown, format: BookFormat): AnnotationChange | string => {
  if (!isObject(body)) return "Expected a JSON object.";
  if (method === "POST" && "highlight" in body) {
    const highlight = parsePassage(body.highlight, format);
    return highlight ? { op: "add-highlight", highlight } : "Invalid highlight.";
  }
  if (method === "POST" && "note" in body) {
    const passage = parsePassage(body.note, format);
    const text = isObject(body.note) ? noteBody(body.note.body) : null;
    if (!passage || !text || !isId(body.highlightId)) return "Invalid note.";
    return { op: "add-note", note: { ...passage, body: text }, highlightId: body.highlightId };
  }
  if (method === "PATCH" && isObject(body.note) && isId(body.note.id)) {
    const text = noteBody(body.note.body);
    return text ? { op: "edit-note", id: body.note.id, body: text } : "A note needs some text.";
  }
  if (method === "DELETE" && isId(body.highlightId)) return { op: "remove-highlight", id: body.highlightId };
  if (method === "DELETE" && isId(body.noteId)) return { op: "remove-note", id: body.noteId };
  return "Unknown change.";
};

/**
 * Applies one change. Each converges: adding an id that exists, or removing
 * one that doesn't, leaves the state as it is. A note always marks its
 * passage, reusing a highlight on the same passage or creating one. Removing a
 * highlight keeps its notes; they lose the link and keep their own quote.
 */
export const applyChange = (state: BookState, change: AnnotationChange, now: string): BookState => {
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

/**
 * Rewrites the book's markdown copy from the saved JSON. Writes queue per
 * book and each reads the latest state when its turn comes, so the file
 * always ends up matching the last change.
 */
const mirror = (book: LibraryBook, dataDir: string, notesDir: string | null): Promise<VaultStatus> =>
  serialized(`vault:${book.id}`, async () => {
    if (!notesDir) return { state: "off" };
    const state = await readBookState(book.id, dataDir);
    const title = state.meta?.title ?? book.fileTitle;
    const author = state.meta?.author ?? book.fileAuthor;
    return writeVault(notesDir, { id: book.id, title, author, format: book.format }, state);
  });

/** Saves the change to the book's JSON, then mirrors it to NOTES_DIR. A failed mirror never undoes the save. */
export const changeAnnotations = async (
  book: LibraryBook,
  change: AnnotationChange,
  dirs: { dataDir: string; notesDir: string | null },
): Promise<{ annotations: Annotations; vault: VaultStatus }> => {
  const now = new Date().toISOString();
  const state = await updateBookState(book.id, (current) => applyChange(current, change, now), dirs.dataDir);
  const vault = await mirror(book, dirs.dataDir, dirs.notesDir);
  return { annotations: { highlights: state.highlights, notes: state.notes }, vault };
};
