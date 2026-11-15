import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { BookFormat, LibraryBook } from "@/lib/shared/types";
import { ConfigError, getConfig } from "./config";
import { parseFileName, type FileTitle } from "./filename";
import { isBookId, LibraryIndexError, readIndex, reconcile, type FileStat, type StoredIndex } from "./library-index";
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

/* Hard links are reported once per index file and set of paths, not on every scan. */
const reportedSkips = new Map<string, string>();
const reportSkipped = (file: string, skipped: ScannedFile[]) => {
  const paths = skipped.map(({ relPath }) => relPath).join(", ");
  if (reportedSkips.get(file) === paths) return;
  reportedSkips.set(file, paths);
  if (paths) console.warn(`Left out of the library because another path already names the same file: ${paths}`);
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
    const { index, books, skipped, changed } = reconcile(current, files);
    reportSkipped(file, skipped);
    if (changed) await writeFileAtomic(file, prettyJson({ version: 1, books: index } satisfies StoredIndex));
    return books.map(({ id, file }) => toBook(id, file));
  });
};

/* Every cover, saved position and chat turn looks its book up, so a scan is reused for a few seconds.
   The cache lives on globalThis because dev bundles each route separately. */
const SCAN_TTL_MS = 5000;
interface Scan {
  at: number;
  books: Promise<LibraryBook[]>;
}
const scans = ((globalThis as { [key: symbol]: unknown })[Symbol.for("rigg-learn.library-scans")] ??= new Map()) as Map<string, Scan>;

const scanKey = (root: string, dataDir: string) => `${path.resolve(root)}\0${path.resolve(dataDir)}`;

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
