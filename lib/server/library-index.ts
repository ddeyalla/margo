import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { BookId } from "@/lib/shared/types";

/** What a scan sees of one book file. `ino` and `dev` are decimal strings because they can exceed 2^53. */
export interface FileStat {
  relPath: string;
  size: number;
  mtimeMs: number;
  ino: string;
  dev: string;
}

/**
 * The last thing seen of a book's file. `sha256` is null until the file has been hashed. `missingSince` is
 * when a scan first failed to find the file, or null while the last scan found it.
 */
export interface IndexEntry extends FileStat {
  sha256: string | null;
  missingSince: number | null;
}

/** Every book that has ever been given an id, by that id. A book whose file is gone stays here. */
export type LibraryIndex = Record<BookId, IndexEntry>;

/** library.json as it is stored. */
export interface StoredIndex {
  version: 1;
  books: LibraryIndex;
}

/** A book id's characters, for patterns that match it inside a longer name. */
export const BOOK_ID_PATTERN = "[0-9a-f]{40}";
const BOOK_ID = new RegExp(`^${BOOK_ID_PATTERN}$`);

export const isBookId = (value: unknown): value is BookId => typeof value === "string" && BOOK_ID.test(value);

/** The id every book had before ids were stored, so a library seeded from it keeps its saved data. */
export const bookIdOf = (relPath: string): BookId => createHash("sha1").update(relPath).digest("hex") as BookId;

/* Random rather than a path hash, so a new book at a path an old book left does not inherit its data. */
export const randomBookId = (): BookId => randomBytes(20).toString("hex") as BookId;

/**
 * library.json exists but is not an index this code wrote. Scans stop rather than re-seed over it, because
 * re-seeding would hand out ids again and strand every moved book's data.
 */
export class LibraryIndexError extends Error {
  override name = "LibraryIndexError";
  constructor(
    readonly file: string,
    reason: string,
    options?: ErrorOptions,
  ) {
    super(`${file}: ${reason}`, options);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isEntry = (value: unknown): value is Omit<IndexEntry, "missingSince"> & { missingSince?: number | null } =>
  isRecord(value) &&
  typeof value.relPath === "string" &&
  typeof value.size === "number" &&
  typeof value.mtimeMs === "number" &&
  typeof value.ino === "string" &&
  typeof value.dev === "string" &&
  (value.sha256 === null || typeof value.sha256 === "string") &&
  (value.missingSince === undefined || value.missingSince === null || typeof value.missingSince === "number");

/** The saved index, or null when there is none yet. Anything else that is not a valid index throws `LibraryIndexError`. */
export const readIndex = async (file: string): Promise<LibraryIndex | null> => {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new LibraryIndexError(file, "could not be read", { cause: error });
  }
  let stored: unknown;
  try {
    stored = JSON.parse(text);
  } catch (error) {
    throw new LibraryIndexError(file, "is not valid JSON", { cause: error });
  }
  if (!isRecord(stored) || stored.version !== 1) throw new LibraryIndexError(file, "is not a version 1 library index");
  if (!isRecord(stored.books)) throw new LibraryIndexError(file, "has no books");
  const index: LibraryIndex = {};
  for (const [id, entry] of Object.entries(stored.books)) {
    if (!isBookId(id) || !isEntry(entry)) throw new LibraryIndexError(file, `has a malformed entry ${JSON.stringify(id)}`);
    index[id] = { ...entry, missingSince: entry.missingSince ?? null };
  }
  return index;
};

type Entry = [BookId, IndexEntry];

/** Content hashes of scanned files, by relPath, taken during this scan. */
export type ScanHashes = ReadonlyMap<string, string>;

/* mtime is part of the key because exFAT and ext4 reuse inode numbers: a new file that lands on a dead
   book's inode almost never has its size and mtime as well. */
const inodeKey = (stat: FileStat) => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
const fileKey = (stat: FileStat) => `${stat.dev}:${stat.ino}`;

/** A key of null takes no part in this matcher. */
interface Matcher {
  file: (file: FileStat, hashes: ScanHashes) => string | null;
  entry: (entry: IndexEntry) => string | null;
}

/**
 * Strongest signal first. A path is only evidence for a book the last scan saw there: a book that was
 * already gone must not be handed to whatever file later lands at its old path. A hash can match any
 * entry, present or missing, because equal bytes are evidence wherever the file now lives.
 */
const MATCHERS: readonly Matcher[] = [
  { file: inodeKey, entry: inodeKey },
  { file: (file) => file.relPath, entry: (entry) => (entry.missingSince === null ? entry.relPath : null) },
  { file: (file, hashes) => hashes.get(file.relPath) ?? null, entry: (entry) => entry.sha256 },
];

const groupBy = <T, K>(items: Iterable<T>, key: (item: T) => K | null): Map<K, T[]> => {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
};

/** Binds every key shared by exactly one of `files` and exactly one of `entries`; anything ambiguous stays unbound. */
export const bindOneToOne = <F extends FileStat>(
  files: readonly F[],
  entries: readonly Entry[],
  keyOfFile: (file: F) => string | null,
  keyOfEntry: (entry: IndexEntry) => string | null,
): Map<F, BookId> => {
  const entriesByKey = groupBy(entries, ([, entry]) => keyOfEntry(entry));
  const bound = new Map<F, BookId>();
  for (const [k, group] of groupBy(files, keyOfFile)) {
    const matches = entriesByKey.get(k);
    if (group.length === 1 && matches?.length === 1) bound.set(group[0], matches[0][0]);
  }
  return bound;
};

const sameEntry = (a: IndexEntry, b: IndexEntry) =>
  a.relPath === b.relPath &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ino === b.ino &&
  a.dev === b.dev &&
  a.sha256 === b.sha256 &&
  a.missingSince === b.missingSince;

/* A changed size or mtime means the bytes may differ, so the old hash no longer describes them. A hash
   taken this scan describes them exactly. */
const refreshed = (entry: IndexEntry | undefined, file: FileStat, hash: string | undefined): IndexEntry => ({
  relPath: file.relPath,
  size: file.size,
  mtimeMs: file.mtimeMs,
  ino: file.ino,
  dev: file.dev,
  sha256: hash ?? (entry && entry.size === file.size && entry.mtimeMs === file.mtimeMs ? entry.sha256 : null),
  missingSince: null,
});

export interface Reconciled<F extends FileStat> {
  index: LibraryIndex;
  /** The scanned files that have an id, in the order given. */
  books: { id: BookId; file: F }[];
  /** Other paths to a file that already has its id this scan, such as hard links. They are left out. */
  skipped: F[];
  /** Entries no file was bound to this scan. */
  orphans: BookId[];
  /** Ids created this scan. */
  minted: BookId[];
  /**
   * Files about to be minted that are the size of an unbound entry with a known hash and are not in
   * `hashes` yet. Reconciling again with their hashes may bind them to that entry instead.
   */
  wantsHash: F[];
  /** False when the index is entry for entry what it was, so a steady-state scan writes nothing. */
  changed: boolean;
}

/* With no index, every file keeps the id its path gave it before ids were stored. */
const seed = <F extends FileStat>(files: readonly F[]): Reconciled<F> => {
  const index: LibraryIndex = {};
  const books = files.map((file) => {
    const id = bookIdOf(file.relPath);
    index[id] = refreshed(undefined, file, undefined);
    return { id, file };
  });
  return { index, books, skipped: [], orphans: [], minted: books.map(({ id }) => id), wantsHash: [], changed: true };
};

/**
 * Gives every scanned file an id, matching the whole scan against the index at once. Each matcher in
 * `MATCHERS` binds only one-to-one matches among what earlier matchers left:
 *
 * 1. Same inode, size and mtime: renames, moves on one volume and two files swapping names. A moved book
 *    keeps its id even when a new file lands at its old path.
 * 2. Same path, for books the previous scan found: editors that save by replacing the file, and a volume
 *    remounted with new device numbers.
 * 3. Same content hash, from `hashes`: a move to another volume, or a save as a new file at a new path.
 *    Only the files in `wantsHash` can bind this way, so the caller reconciles once without hashes,
 *    hashes those, and reconciles the same index again with them.
 *
 * A file still unbound is another path to a file already bound (a hard link, or a book seen at both ends
 * of a move made during the scan) and is skipped, because an id minted for it would share the book's inode
 * and strand the book's data on the next scan. Anything else gets a new random id.
 *
 * With no index entries the files are seeded. A scan with no files changes nothing, because an empty or
 * unmounted books folder must not be read as every book being gone.
 */
export interface ReconcileOptions {
  newId?: () => BookId;
  /** When an entry first went missing, for entries no file is bound to. */
  now?: number;
  hashes?: ScanHashes;
}

export const reconcile = <F extends FileStat>(
  current: LibraryIndex | null,
  files: readonly F[],
  { newId = randomBookId, now = Date.now(), hashes = new Map() }: ReconcileOptions = {},
): Reconciled<F> => {
  const before = current ?? {};
  const entries = Object.entries(before) as Entry[];
  if (files.length === 0) return { index: before, books: [], skipped: [], orphans: [], minted: [], wantsHash: [], changed: false };
  if (entries.length === 0) return seed(files);

  const ids = new Map<F, BookId>();
  const boundIds = new Set<BookId>();
  const unboundEntries = () => entries.filter(([id]) => !boundIds.has(id));
  for (const matcher of MATCHERS) {
    const unboundFiles = files.filter((file) => !ids.has(file));
    for (const [file, id] of bindOneToOne(unboundFiles, unboundEntries(), (file) => matcher.file(file, hashes), matcher.entry)) {
      ids.set(file, id);
      boundIds.add(id);
    }
  }

  const boundFiles = new Set([...ids.keys()].map(fileKey));
  const skipped = files.filter((file) => !ids.has(file) && boundFiles.has(fileKey(file)));
  const skip = new Set(skipped);
  const hashedSizes = new Set(unboundEntries().flatMap(([, entry]) => (entry.sha256 === null ? [] : [entry.size])));
  const wantsHash = files.filter((file) => !ids.has(file) && !skip.has(file) && !hashes.has(file.relPath) && hashedSizes.has(file.size));
  const minted = new Set<BookId>();
  for (const file of files) {
    if (ids.has(file) || skip.has(file)) continue;
    let id = newId();
    while (id in before || minted.has(id)) id = newId();
    ids.set(file, id);
    minted.add(id);
  }

  const index: LibraryIndex = { ...before };
  const books = files.flatMap((file) => {
    const id = ids.get(file);
    if (!id) return [];
    index[id] = refreshed(before[id], file, hashes.get(file.relPath));
    return [{ id, file }];
  });
  const orphans = entries.filter(([id]) => !boundIds.has(id)).map(([id]) => id);
  for (const id of orphans) {
    if (before[id].missingSince === null) index[id] = { ...before[id], missingSince: now };
  }
  const changed = minted.size > 0 || entries.some(([id, entry]) => !sameEntry(entry, index[id]));
  return { index, books, skipped, orphans, minted: [...minted], wantsHash, changed };
};
