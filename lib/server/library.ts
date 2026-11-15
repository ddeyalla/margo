import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { BookFormat, BookId, LibraryBook } from "@/lib/shared/types";
import { ConfigError, getConfig } from "./config";
import { parseFileName, type FileTitle } from "./filename";
import {
  isBookId,
  LibraryIndexError,
  readIndex,
  reconcile,
  type FileStat,
  type IndexEntry,
  type LibraryIndex,
  type StoredIndex,
} from "./library-index";
import { prettyJson, serialized, writeFileAtomic } from "./store";

export { bookIdOf, isBookId } from "./library-index";

const FORMATS: Record<string, BookFormat> = { ".epub": "epub", ".pdf": "pdf" };

const toPosix = (relPath: string) => relPath.split(path.sep).join("/");

interface ScannedFile extends FileStat {
  format: BookFormat;
  folder: string;
  name: FileTitle;
}

const walkLibrary = async (root: string): Promise<ScannedFile[]> => {
  const files: ScannedFile[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.name.startsWith(".")) return;
        const absPath = path.join(/*turbopackIgnore: true*/ dir, entry.name);
        if (entry.isDirectory()) return walk(absPath);
        const format = FORMATS[path.extname(entry.name).toLowerCase()];
        if (!entry.isFile() || !format) return;
        /* A file renamed between listing its folder and reading it is found under its new name instead. */
        const info = await stat(absPath, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (!info) return;
        files.push({
          relPath: toPosix(path.relative(root, absPath)),
          size: Number(info.size),
          mtimeMs: Number(info.mtimeMs),
          ino: info.ino.toString(),
          dev: info.dev.toString(),
          format,
          folder: toPosix(path.relative(root, dir)),
          name: parseFileName(entry.name),
        });
      }),
    );
  };
  await walk(root);
  return files.sort((a, b) => a.relPath.localeCompare(b.relPath));
};

const toBook = (id: LibraryBook["id"], file: ScannedFile): LibraryBook => ({
  id,
  format: file.format,
  relPath: file.relPath,
  folder: file.folder,
  fileTitle: file.name.title,
  fileAuthor: file.name.author,
  sizeBytes: file.size,
  modifiedAt: new Date(file.mtimeMs).toISOString(),
});

const indexFile = (dataDir: string) => path.join(/*turbopackIgnore: true*/ dataDir, "library.json");

/* One library is one books folder read against one data folder. */
const scanKey = (root: string, dataDir: string) => `${path.resolve(root)}\0${path.resolve(dataDir)}`;

/* Hard links are reported once per index file and set of paths, not on every scan. */
const reportedSkips = new Map<string, string>();
const reportSkipped = (file: string, skipped: ScannedFile[]) => {
  const paths = skipped.map(({ relPath }) => relPath).join(", ");
  if (reportedSkips.get(file) === paths) return;
  reportedSkips.set(file, paths);
  if (paths) console.warn(`Left out of the library because another path already names the same file: ${paths}`);
};

const writeIndex = (file: string, index: LibraryIndex) => writeFileAtomic(file, prettyJson({ version: 1, books: index } satisfies StoredIndex));

const sha256OfFile = (absPath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(absPath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });

type FileIdentity = Omit<FileStat, "relPath">;

const sameFile = (a: FileIdentity, b: FileIdentity) => a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino && a.dev === b.dev;

const statOf = async (absPath: string): Promise<FileIdentity> => {
  const info = await stat(absPath, { bigint: true });
  return { size: Number(info.size), mtimeMs: Number(info.mtimeMs), ino: info.ino.toString(), dev: info.dev.toString() };
};

/**
 * The hash of the file `expected` describes, or null when the file is no longer that file before or after
 * reading it, because a hash of other bytes would bind or describe the wrong book.
 */
const hashIfUnchanged = async (root: string, expected: FileStat, hash: (absPath: string) => Promise<string>): Promise<string | null> => {
  const absPath = path.join(/*turbopackIgnore: true*/ root, expected.relPath);
  if (!sameFile(await statOf(absPath), expected)) return null;
  const sha256 = await hash(absPath);
  return sameFile(await statOf(absPath), expected) ? sha256 : null;
};

const quietIfGone = (relPath: string) => (error: NodeJS.ErrnoException) => {
  if (error.code !== "ENOENT") console.warn(`Could not hash ${relPath}:`, error);
  return null;
};

/* Only files the same size as a hashed orphan are read, so a scan in which nothing moved reads nothing. */
const hashCandidates = async (root: string, files: readonly FileStat[]): Promise<Map<string, string>> => {
  const hashes = new Map<string, string>();
  for (const file of files) {
    const sha256 = await hashIfUnchanged(root, file, sha256OfFile).catch(quietIfGone(file.relPath));
    if (sha256) hashes.set(file.relPath, sha256);
  }
  return hashes;
};

/**
 * Lists the books folder and gives each file its id from library.json. The listing happens inside the
 * index's queue too, so a scan that listed the folder earlier can never write after one that listed it later.
 */
const identify = (root: string, dataDir: string): Promise<LibraryBook[]> => {
  const file = indexFile(dataDir);
  return serialized(file, async () => {
    const current = await readIndex(file);
    const files = await walkLibrary(root);
    const first = reconcile(current, files);
    const { index, books, skipped, changed } =
      first.wantsHash.length > 0 ? reconcile(current, files, undefined, undefined, await hashCandidates(root, first.wantsHash)) : first;
    reportSkipped(file, skipped);
    if (changed) await writeIndex(file, index);
    if (books.some(({ id }) => index[id].sha256 === null)) void backfillHashes(root, dataDir);
    return books.map(({ id, file }) => toBook(id, file));
  });
};

const backfills = ((globalThis as { [key: symbol]: unknown })[Symbol.for("rigg-learn.library-backfills")] ??= new Map()) as Map<
  string,
  Promise<void>
>;

/**
 * Hashes every present book that has no hash yet, one file at a time, and saves each hash to library.json,
 * so a later move to another volume can be matched by content. Scans start it without waiting for it, and
 * only one runs per library; calling it while one runs returns that run. A hash is saved only if neither
 * the file nor its entry changed while it was read. Errors are logged and never reach a scan.
 */
export const backfillHashes = (
  root: string = getConfig().booksDir,
  dataDir: string = getConfig().dataDir,
  hash: (absPath: string) => Promise<string> = sha256OfFile,
): Promise<void> => {
  const key = scanKey(root, dataDir);
  const running = backfills.get(key);
  if (running) return running;
  const file = indexFile(dataDir);
  const finish = () => {
    if (backfills.get(key) === run) backfills.delete(key);
  };
  const tried = new Set<string>();
  const attempt = (id: BookId, entry: IndexEntry) => `${id}:${entry.size}:${entry.mtimeMs}`;
  const run = (async () => {
    try {
      for (;;) {
        /* The run ends inside the queue, so a scan that adds an unhashed book after this look starts a new run. */
        const next = await serialized(file, async () => {
          const index = (await readIndex(file)) ?? {};
          const found = (Object.entries(index) as [BookId, IndexEntry][]).find(
            ([id, entry]) => entry.missingSince === null && entry.sha256 === null && !tried.has(attempt(id, entry)),
          );
          if (!found) finish();
          return found;
        });
        if (!next) return;
        const [id, hashed] = next;
        tried.add(attempt(id, hashed));
        const sha256 = await hashIfUnchanged(root, hashed, hash).catch(quietIfGone(hashed.relPath));
        if (!sha256) continue;
        await serialized(file, async () => {
          const index = await readIndex(file);
          const entry = index?.[id];
          if (!index || !entry || entry.sha256 !== null || entry.relPath !== hashed.relPath || !sameFile(entry, hashed)) return;
          index[id] = { ...entry, sha256 };
          await writeIndex(file, index);
        });
      }
    } catch (error) {
      console.warn("Stopped hashing library books:", error);
    } finally {
      finish();
    }
  })();
  backfills.set(key, run);
  return run;
};

/* Every cover, saved position and chat turn looks its book up, so a scan is reused for a few seconds.
   The cache lives on globalThis because dev bundles each route separately. */
const SCAN_TTL_MS = 5000;
interface Scan {
  at: number;
  books: Promise<LibraryBook[]>;
}
const scans = ((globalThis as { [key: symbol]: unknown })[Symbol.for("rigg-learn.library-scans")] ??= new Map()) as Map<string, Scan>;

const freshScan = (root: string, dataDir: string): Scan | null => {
  const scan = scans.get(scanKey(root, dataDir));
  return scan && Date.now() - scan.at < SCAN_TTL_MS ? scan : null;
};

const rescan = (root: string, dataDir: string): Promise<LibraryBook[]> => {
  const key = scanKey(root, dataDir);
  const scan: Scan = { at: Date.now(), books: identify(root, dataDir) };
  scans.set(key, scan);
  scan.books.catch(() => {
    if (scans.get(key) === scan) scans.delete(key);
  });
  return scan.books;
};

/** Every EPUB and PDF under `root`, read from disk now, with the ids library.json in `dataDir` gives them. Hidden files and folders are skipped. */
export const scanLibrary = async (root: string = getConfig().booksDir, dataDir: string = getConfig().dataDir): Promise<LibraryBook[]> => [
  ...(await rescan(root, dataDir)),
];

export interface FoundBook {
  book: LibraryBook;
  absPath: string;
}

/**
 * The only way to turn a request into a file path. The id must match a book
 * the scan found, so a crafted id can never name a file outside BOOKS_DIR.
 */
export const findBook = async (
  id: unknown,
  root: string = getConfig().booksDir,
  dataDir: string = getConfig().dataDir,
): Promise<FoundBook | null> => {
  if (!isBookId(id)) return null;
  const cached = freshScan(root, dataDir);
  const byId = (books: LibraryBook[]) => books.find((candidate) => candidate.id === id);
  /* A book added since the cached scan is found by looking again once. */
  const book = (cached && byId(await cached.books)) || byId(await rescan(root, dataDir));
  if (!book) return null;
  const absPath = path.resolve(/*turbopackIgnore: true*/ root, book.relPath);
  const inside = path.relative(path.resolve(root), absPath);
  if (!inside || inside === ".." || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) return null;
  return { book, absPath };
};

/** Plain words for why the library can't be listed, for the library and book pages alike. */
export const libraryProblem = (error: unknown, root?: string): string => {
  if (error instanceof ConfigError) return error.message;
  if (error instanceof LibraryIndexError)
    return `The saved library index in the data folder (${error.file}) can't be read, so nothing was changed. Fix or restore that file, then reload.`;
  const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
  return missing
    ? `The books folder ${root ?? getConfig().booksDir} does not exist. Check the books folder under Folders, or BOOKS_DIR in .env.local.`
    : "The books folder could not be read. Check the books folder under Folders, or BOOKS_DIR in .env.local.";
};
