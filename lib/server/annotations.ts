import {
  applyChange,
  CHANGE_METHODS,
  type AnnotationChange,
  type AnnotationMethod,
  type Passage,
} from "@/lib/shared/annotations";
import { normalizeText } from "@/lib/shared/context";
import type { Annotations, BookFormat, LibraryBook, VaultStatus } from "@/lib/shared/types";
import { evidenceOf } from "@/lib/shared/ledger";
import { noteEvidence } from "./ledger";
import { updateBookState } from "./store";
import { isObject, MAX_QUOTE, parseAnchor, shortText } from "./validate";
import { mirrorVault } from "./vault";

const MAX_NOTE = 20_000;

const isId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const noteBody = (value: unknown): string | null => shortText(value, MAX_NOTE);

const parsePassage = (value: unknown, format: BookFormat): Passage | null => {
  if (!isObject(value) || !isId(value.id)) return null;
  const anchor = parseAnchor(value.anchor, format);
  /* A long selection keeps its first MAX_QUOTE characters rather than failing; the anchor still covers all of it. */
  const quote = typeof value.quote === "string" ? normalizeText(value.quote.slice(0, MAX_QUOTE * 2)).slice(0, MAX_QUOTE).trim() : "";
  if (!anchor || !quote) return null;
  return { id: value.id, anchor, quote, chapterTitle: shortText(value.chapterTitle, 500) };
};

/** Validates a change sent as JSON. It travels with its own method: POST adds, PATCH edits, DELETE removes. */
export const parseChange = (method: AnnotationMethod, body: unknown, format: BookFormat): AnnotationChange | string => {
  if (!isObject(body) || typeof body.op !== "string" || !Object.hasOwn(CHANGE_METHODS, body.op)) return "Unknown change.";
  const op = body.op as AnnotationChange["op"];
  if (CHANGE_METHODS[op] !== method) return `Send ${op} as ${CHANGE_METHODS[op]}.`;
  switch (op) {
    case "add-highlight": {
      const highlight = parsePassage(body.highlight, format);
      return highlight ? { op, highlight } : "Invalid highlight.";
    }
    case "add-note": {
      const passage = parsePassage(body.note, format);
      const text = isObject(body.note) ? noteBody(body.note.body) : null;
      if (!passage || !text || !isId(body.highlightId)) return "Invalid note.";
      return { op, note: { ...passage, body: text }, highlightId: body.highlightId };
    }
    case "edit-note": {
      const text = noteBody(body.body);
      return isId(body.id) && text ? { op, id: body.id, body: text } : "A note needs some text.";
    }
    case "remove-highlight":
    case "remove-note":
      return isId(body.id) ? { op, id: body.id } : "Invalid id.";
  }
};

/** Saves the change to the book's JSON, then mirrors it to NOTES_DIR. A failed mirror never undoes the save. */
export const changeAnnotations = async (
  book: LibraryBook,
  change: AnnotationChange,
  dirs: { dataDir: string; notesDir: string | null },
): Promise<{ annotations: Annotations; vault: VaultStatus }> => {
  const now = new Date().toISOString();
  const state = await updateBookState(book.id, (current) => ({ ...current, ...applyChange(current, change, now) }), dirs.dataDir);
  if (change.op === "add-highlight" || change.op === "add-note") noteEvidence(evidenceOf(book.id, state), dirs.dataDir);
  const vault = await mirrorVault(book, dirs.dataDir, dirs.notesDir);
  return { annotations: { highlights: state.highlights, notes: state.notes }, vault };
};
