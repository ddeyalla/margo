import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import type { RelinkCandidate } from "@/lib/shared/relink";
import type { BookFormat, BookId, BookState, MissingBook } from "@/lib/shared/types";
import { attachmentsDir } from "./attachments";
import { ConfigError, getConfig } from "./config";
import { coverFiles, dropCover } from "./covers";
import { changeLibrary, FORMATS, libraryProblem, type ScannedLibrary } from "./library";
import { LibraryIndexError, type LibraryIndex } from "./library-index";
import { readBookState, savedFiles, serialized } from "./store";

/** Why a relink or forget was refused or failed. Each code is one answer the routes give. */
export type MissingBookProblem = "same_book" | "not_missing" | "target_not_found" | "target_has_data" | "format_mismatch" | "not_moved";

export class MissingBookError extends Error {
  override name = "MissingBookError";
  constructor(
    readonly problem: MissingBookProblem,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The ids of books that have saved data and no file. A scan that found no books proves nothing is missing:
 * an empty or unmounted books folder would otherwise make every book look gone and offer its data to Forget.
 */
export const missingIds = ({ books, index, saved }: ScannedLibrary): BookId[] => {
  if (books.length === 0) return [];
  const present = new Set(books.map((book) => book.id));
  return [...saved].filter((id) => {
    if (present.has(id)) return false;
    const entry = index[id];
    return !entry || entry.missingSince !== null;
  });
};

/** The books in the folder with nothing saved under their own ids, the only ones that can take a missing book's place. */
export const relinkCandidates = ({ books, saved }: ScannedLibrary): RelinkCandidate[] =>
  books
    .filter((book) => !saved.has(book.id))
    .map((book) => ({ id: book.id, title: book.fileTitle, relPath: book.relPath, format: book.format, sizeBytes: book.sizeBytes }));

/** Where a missing book was last seen: its index entry, else the path its state recorded. */
const lastPath = (id: BookId, index: LibraryIndex, state: BookState | null) => index[id]?.relPath ?? state?.meta?.relPath ?? null;

/** A missing book's format: what its state recorded, else its last path's extension. */
const formatOf = (state: BookState | null, relPath: string | null): BookFormat | null =>
  state?.meta?.format ?? (relPath ? (FORMATS[path.posix.extname(relPath).toLowerCase()] ?? null) : null);

/* A missing book may have no state file at all (only a position), or one this code can't read. */
const readState = (id: BookId, dataDir: string): Promise<BookState | null> => readBookState(id, dataDir).catch(() => null);

const describe = async (id: BookId, index: LibraryIndex, dataDir: string): Promise<MissingBook> => {
  const entry = index[id];
  const state = await readState(id, dataDir);
  const relPath = lastPath(id, index, state);
  return {
    id,
    title: state?.meta?.title || (relPath ? path.posix.basename(relPath) : "Unknown book"),
    format: formatOf(state, relPath),
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

export interface MissingBooks {
  missing: MissingBook[];
  candidates: RelinkCandidate[];
}

/**
 * Every book in `library` with a state or position file that no file in the books folder is bound to, and
 * the books that could take one's place. The state files are read after the scan, outside the index's queue,
 * because describing is only for show; relink and forget check again in the queue.
 */
export const listMissing = async (library: ScannedLibrary, dataDir: string = getConfig().dataDir): Promise<MissingBooks> => {
  const missing = await Promise.all(missingIds(library).map((id) => describe(id, library.index, dataDir)));
  return { missing: missing.sort((a, b) => a.title.localeCompare(b.title)), candidates: relinkCandidates(library) };
};

const assertMissing = (scan: ScannedLibrary, id: BookId) => {
  if (!missingIds(scan).includes(id)) throw new MissingBookError("not_missing", "There is no missing book with that id.");
};

const FORMAT_NAMES: Record<BookFormat, string> = { epub: "an EPUB", pdf: "a PDF" };

/**
 * Gives the file the scan now calls `newId` the id `oldId`, so the missing book's saved data opens with that
 * file, and drops `newId`. The target must be a book the scan found, in the missing book's format when that is
 * known, and must have nothing saved under its own id, because that data would be stranded. Both covers are
 * dropped: `newId`'s names no book now, and `oldId`'s was drawn from the old file.
 */
export const rebind = (
  oldId: BookId,
  newId: BookId,
  root: string = getConfig().booksDir,
  dataDir: string = getConfig().dataDir,
): Promise<void> => {
  if (oldId === newId) return Promise.reject(new MissingBookError("same_book", "A book can't be relinked to itself."));
  return changeLibrary(
    root,
    dataDir,
    async (scan) => {
      const target = scan.books.find((book) => book.id === newId);
      const entry = scan.index[newId];
      if (!target || !entry) throw new MissingBookError("target_not_found", "That file is not in the books folder now.");
      assertMissing(scan, oldId);
      const state = await readState(oldId, dataDir);
      const format = formatOf(state, lastPath(oldId, scan.index, state));
      if (format && format !== target.format) {
        throw new MissingBookError("format_mismatch", `That file is ${FORMAT_NAMES[target.format]}, and this book was ${FORMAT_NAMES[format]}.`);
      }
      if (scan.saved.has(newId)) {
        throw new MissingBookError("target_has_data", "That file already has saved highlights, notes or a reading place of its own.");
      }
      const index: LibraryIndex = { ...scan.index, [oldId]: { ...entry, missingSince: null } };
      delete index[newId];
      await Promise.all([dropCover(newId, dataDir), dropCover(oldId, dataDir)]);
      return { index, value: undefined, rescan: true };
    },
    [oldId, newId],
  );
};

/** Moves `from` to `to`, keeping its name under a new folder. A part this book never had is skipped. */
const moveIfThere = async (from: string, to: string) => {
  await mkdir(path.dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
};

/**
 * A folder of its own for this attempt, so a retry after a failed one never renames onto a file an earlier
 * attempt already moved.
 */
const trashFolder = async (id: BookId, dataDir: string): Promise<string> => {
  const parent = path.join(/*turbopackIgnore: true*/ dataDir, "forgotten");
  await mkdir(parent, { recursive: true });
  for (let at = Date.now(); ; at += 1) {
    const dir = path.join(/*turbopackIgnore: true*/ parent, `${id}-${at}`);
    try {
      await mkdir(dir);
      return dir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
};

/**
 * Moves everything the data folder keeps for a book into `forgotten/<id>-<time>/`, laid out as it was, so it
 * can be put back by hand. The state file goes last: a failure part-way leaves it, so the book stays listed
 * and Forget can be tried again. The caller holds the state and position queues, so those move directly.
 */
const moveToForgotten = async (id: BookId, dataDir: string) => {
  const trash = await trashFolder(id, dataDir);
  const into = (file: string) => path.join(/*turbopackIgnore: true*/ trash, path.relative(dataDir, file));
  const [jpg, none] = coverFiles(id, dataDir);
  await serialized(jpg, async () => {
    await moveIfThere(jpg, into(jpg));
    await moveIfThere(none, into(none));
  });
  const attachments = attachmentsDir(id, dataDir);
  await moveIfThere(attachments, into(attachments));
  const [state, position] = savedFiles(id, dataDir);
  await moveIfThere(position, into(position));
  await moveIfThere(state, into(state));
};

/**
 * Moves what the app keeps for a missing book (state, position, cover and chat images) to the forgotten
 * folder in the data folder, then drops its index entry. Notes in the notes folder are the reader's files and
 * stay. It runs inside the index's queue, so no relink can bind a file to this id while its data moves.
 */
export const forget = (id: BookId, root: string = getConfig().booksDir, dataDir: string = getConfig().dataDir): Promise<void> =>
  changeLibrary(
    root,
    dataDir,
    async (scan) => {
      assertMissing(scan, id);
      try {
        await moveToForgotten(id, dataDir);
      } catch (error) {
        console.error(error);
        throw new MissingBookError(
          "not_moved",
          "Some of this book's files could not be moved to the forgotten folder. Nothing was lost; try again.",
        );
      }
      const index: LibraryIndex = { ...scan.index };
      delete index[id];
      return { index, value: undefined, rescan: true };
    },
    [id],
  );

const STATUS: Record<MissingBookProblem, number> = {
  same_book: 400,
  not_missing: 404,
  target_not_found: 404,
  target_has_data: 409,
  format_mismatch: 409,
  not_moved: 500,
};

/** The answer for an error from a missing-books call: its refusal, or the library's own problem in plain words. */
export const missingBookResponse = (error: unknown): Response => {
  if (error instanceof MissingBookError) return Response.json({ error: error.message }, { status: STATUS[error.problem] });
  if (!(error instanceof LibraryIndexError) && !(error instanceof ConfigError)) console.error(error);
  return Response.json({ error: libraryProblem(error) }, { status: 500 });
};
