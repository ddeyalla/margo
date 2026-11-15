import { createHash, randomBytes } from "node:crypto";
import type { BookId } from "@/lib/shared/types";

/** What a scan sees of one book file. `ino` and `dev` are decimal strings because they can exceed 2^53. */
export interface FileStat {
  relPath: string;
  size: number;
  mtimeMs: number;
  ino: string;
  dev: string;
}

/** The last thing seen of a book's file. `sha256` is null until the file has been hashed. */
export interface IndexEntry extends FileStat {
  sha256: string | null;
}

/** Every book that has ever been given an id, by that id. A book whose file is gone stays here. */
export type LibraryIndex = Record<BookId, IndexEntry>;

/** The id every book had before ids were stored, so a library seeded from it keeps its saved data. */
export const bookIdOf = (relPath: string): BookId => createHash("sha1").update(relPath).digest("hex") as BookId;

/* Random rather than a path hash, so a new book at a path an old book left does not inherit its data. */
export const randomBookId = (): BookId => randomBytes(20).toString("hex") as BookId;

const sameEntry = (a: IndexEntry, b: IndexEntry) =>
  a.relPath === b.relPath && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino && a.dev === b.dev && a.sha256 === b.sha256;

/* A changed size or mtime means the bytes may differ, so the old hash no longer describes them. */
const refreshed = (entry: IndexEntry, file: FileStat): IndexEntry => ({
  relPath: file.relPath,
  size: file.size,
  mtimeMs: file.mtimeMs,
  ino: file.ino,
  dev: file.dev,
  sha256: entry.size === file.size && entry.mtimeMs === file.mtimeMs ? entry.sha256 : null,
});

const groupBy = <T, K>(items: Iterable<T>, key: (item: T) => K): Map<K, T[]> => {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  return groups;
};

export interface Reconciled<F extends FileStat> {
  index: LibraryIndex;
  /** The scanned files that have an id, in the order given. */
  books: { id: BookId; file: F }[];
  /** False when the index is entry for entry what it was, so a steady-state scan writes nothing. */
  changed: boolean;
}

/**
 * Gives every scanned file an id, matching the whole scan against the index at once:
 *
 * 1. Same inode: a file whose dev + inode + size matches exactly one entry, and that entry no other file,
 *    takes that entry's id wherever it now lives. This covers renames, moves on one volume and two files
 *    swapping names, and lets a moved book keep its id when a new file lands at its old path.
 * 2. Same path: a file still unmatched takes the one unmatched entry recorded at its path. This covers
 *    editors that save by replacing the file, and a volume remounted with a new device number.
 * 3. Anything left is a new book with a random id, except another path to a file that already matched:
 *    a hard link, or a book seen at both ends of a move made during the scan. That path is left out of
 *    this scan, because an id minted for it would share the book's inode and strand the book's data on
 *    the next scan.
 *
 * Every match is one-to-one; anything ambiguous becomes a new book and leaves the entries as they were.
 * With no index entries the files are seeded with `bookIdOf(relPath)`. A scan with no files changes
 * nothing, because an empty or unmounted books folder must not be read as every book being gone.
 */
export const reconcile = <F extends FileStat>(
  current: LibraryIndex | null,
  files: readonly F[],
  newId: () => BookId = randomBookId,
): Reconciled<F> => {
  const before = current ?? {};
  const entries = Object.entries(before) as [BookId, IndexEntry][];
  if (files.length === 0) return { index: before, books: [], changed: false };

  const ids = new Map<F, BookId>();
  const skipped = new Set<F>();
  if (entries.length === 0) {
    for (const file of files) ids.set(file, bookIdOf(file.relPath));
  } else {
    const bound = new Set<BookId>();
    const inodeKey = (stat: FileStat) => `${stat.dev}:${stat.ino}:${stat.size}`;
    const filesByInode = groupBy(files, inodeKey);
    const entriesByInode = groupBy(entries, ([, entry]) => inodeKey(entry));
    for (const file of files) {
      const key = inodeKey(file);
      const matches = entriesByInode.get(key) ?? [];
      if (matches.length !== 1 || filesByInode.get(key)?.length !== 1) continue;
      ids.set(file, matches[0][0]);
      bound.add(matches[0][0]);
    }

    const entriesByPath = groupBy(
      entries.filter(([id]) => !bound.has(id)),
      ([, entry]) => entry.relPath,
    );
    for (const file of files) {
      if (ids.has(file)) continue;
      const matches = entriesByPath.get(file.relPath) ?? [];
      if (matches.length === 1) ids.set(file, matches[0][0]);
    }

    for (const file of files) {
      if (!ids.has(file) && filesByInode.get(inodeKey(file))!.some((twin) => ids.has(twin))) skipped.add(file);
    }
    for (const file of files) {
      if (ids.has(file) || skipped.has(file)) continue;
      let id = newId();
      while (id in before) id = newId();
      ids.set(file, id);
    }
  }

  const index: LibraryIndex = { ...before };
  const books = files.filter((file) => !skipped.has(file)).map((file) => {
    const id = ids.get(file)!;
    const entry = before[id];
    index[id] = refreshed(entry ?? { ...file, sha256: null }, file);
    return { id, file };
  });
  const changed = books.some(({ id }) => !before[id] || !sameEntry(before[id], index[id]));
  return { index, books, changed };
};
