import path from "node:path";
import type { BookFormat, BookId, BookState, MissingBook } from "@/lib/shared/types";
import { deleteAttachments } from "./attachments";
import { ConfigError, getConfig } from "./config";
import { dropCover } from "./covers";
import { changeLibrary, libraryProblem, type ScannedLibrary } from "./library";
import { LibraryIndexError, type LibraryIndex } from "./library-index";
import { deleteBookState, hasSavedData, readBookState, savedBookIds } from "./store";

/** Why a relink or forget was refused. Each code is one answer the routes give. */
export type MissingBookProblem = "same_book" | "not_missing" | "target_not_found" | "target_has_data";

export class MissingBookError extends Error {
  override name = "MissingBookError";
  constructor(
    readonly problem: MissingBookProblem,
    message: string,
  ) {
    super(message);
  }
}

const FORMATS: Record<string, BookFormat> = { ".epub": "epub", ".pdf": "pdf" };

const coversDir = (dataDir: string) => path.join(/*turbopackIgnore: true*/ dataDir, "covers");

/**
 * The ids of books that have saved data and no file. A scan that found no books proves nothing is missing:
 * an empty or unmounted books folder would otherwise make every book look gone and offer its data to Forget.
 */
const missingIds = (scan: ScannedLibrary, saved: ReadonlySet<BookId>): BookId[] => {
  if (scan.books.length === 0) return [];
  const present = new Set(scan.books.map((book) => book.id));
  return [...saved].filter((id) => {
    if (present.has(id)) return false;
    const entry = scan.index[id];
    return !entry || entry.missingSince !== null;
  });
};

/* A missing book may have no state file at all (only a position), or one this code can't read. */
const describe = async (id: BookId, index: LibraryIndex, dataDir: string): Promise<MissingBook> => {
  const entry = index[id];
  const state: BookState | null = await readBookState(id, dataDir).catch(() => null);
  const relPath = entry?.relPath ?? state?.meta?.relPath ?? null;
  return {
    id,
    title: state?.meta?.title || (relPath ? path.posix.basename(relPath) : "Unknown book"),
    format: state?.meta?.format ?? (relPath ? (FORMATS[path.posix.extname(relPath).toLowerCase()] ?? null) : null),
    relPath,
    sizeBytes: entry?.size ?? null,
    missingSince: entry?.missingSince ?? null,
    saved: state && {
      highlights: state.highlights.length,
      notes: state.notes.length,
      cardSets: state.cardSets.length,
      threads: state.threads.length,
      hasPosition: state.position !== null,
    },
  };
};

/** Every book with a state or position file in the data folder that no file in the books folder is now bound to. */
export const listMissing = (root: string = getConfig().booksDir, dataDir: string = getConfig().dataDir): Promise<MissingBook[]> =>
  changeLibrary(root, dataDir, async (scan) => {
    const ids = missingIds(scan, await savedBookIds(dataDir));
    const books = await Promise.all(ids.map((id) => describe(id, scan.index, dataDir)));
    return { value: books.sort((a, b) => a.title.localeCompare(b.title)) };
  });

const assertMissing = async (scan: ScannedLibrary, id: BookId, dataDir: string) => {
  if (!missingIds(scan, await savedBookIds(dataDir)).includes(id)) {
    throw new MissingBookError("not_missing", "There is no missing book with that id.");
  }
};

/**
 * Gives the file the scan now calls `newId` the id `oldId`, so the missing book's saved data opens with that
 * file, and drops `newId`. The target must be a book the scan found, and must have nothing saved under its
 * own id, because that data would be stranded. Both covers are dropped: `newId`'s names no book now, and
 * `oldId`'s was drawn from the old file.
 */
export const rebind = (
  oldId: BookId,
  newId: BookId,
  root: string = getConfig().booksDir,
  dataDir: string = getConfig().dataDir,
): Promise<void> =>
  changeLibrary(root, dataDir, async (scan) => {
    if (oldId === newId) throw new MissingBookError("same_book", "A book can't be relinked to itself.");
    const target = scan.index[newId];
    if (!target || !scan.books.some((book) => book.id === newId)) {
      throw new MissingBookError("target_not_found", "That file is not in the books folder now.");
    }
    await assertMissing(scan, oldId, dataDir);
    if (await hasSavedData(newId, dataDir)) {
      throw new MissingBookError("target_has_data", "That file already has saved highlights, notes or a reading place of its own.");
    }
    const index: LibraryIndex = { ...scan.index, [oldId]: { ...target, missingSince: null } };
    delete index[newId];
    await Promise.all([dropCover(newId, coversDir(dataDir)), dropCover(oldId, coversDir(dataDir))]);
    return { index, value: undefined };
  });

/**
 * Deletes everything the app keeps for a missing book: its index entry, state, position, cover and chat
 * images. Notes in the notes folder are the reader's files and stay. It runs inside the index's queue, so
 * no relink can bind a file to this id while its data is being deleted.
 */
export const forget = (id: BookId, root: string = getConfig().booksDir, dataDir: string = getConfig().dataDir): Promise<void> =>
  changeLibrary(root, dataDir, async (scan) => {
    await assertMissing(scan, id, dataDir);
    await Promise.all([deleteBookState(id, dataDir), dropCover(id, coversDir(dataDir)), deleteAttachments(id, dataDir)]);
    const index: LibraryIndex = { ...scan.index };
    delete index[id];
    return { index, value: undefined };
  });

const STATUS: Record<MissingBookProblem, number> = { same_book: 400, not_missing: 404, target_not_found: 404, target_has_data: 409 };

/** The answer for an error from a missing-books call: its refusal, or the library's own problem in plain words. */
export const missingBookResponse = (error: unknown): Response => {
  if (error instanceof MissingBookError) return Response.json({ error: error.message }, { status: STATUS[error.problem] });
  if (!(error instanceof LibraryIndexError) && !(error instanceof ConfigError)) console.error(error);
  return Response.json({ error: libraryProblem(error) }, { status: 500 });
};
