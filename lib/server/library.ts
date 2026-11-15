import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { BookFormat, BookId, LibraryBook } from "@/lib/shared/types";
import { ConfigError, getConfig } from "./config";
import { parseFileName } from "./filename";
import { reconcile, type FileStat, type LibraryIndex } from "./library-index";
import { readJson, serialized, writeFileAtomic } from "./store";

export { bookIdOf } from "./library-index";

const FORMATS: Record<string, BookFormat> = { ".epub": "epub", ".pdf": "pdf" };

export const isBookId = (value: unknown): value is BookId =>
  typeof value === "string" && /^[0-9a-f]{40}$/.test(value);

const toPosix = (relPath: string) => relPath.split(path.sep).join("/");

type ScannedFile = FileStat & { book: Omit<LibraryBook, "id"> };

const walkLibrary = async (root: string): Promise<ScannedFile[]> => {
  const books: ScannedFile[] = [];
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
        const relPath = toPosix(path.relative(root, absPath));
        const { title, author } = parseFileName(entry.name);
        const size = Number(info.size);
        books.push({
          relPath,
          size,
          mtimeMs: Number(info.mtimeMs),
          ino: info.ino.toString(),
          dev: info.dev.toString(),
          book: {
            format,
            relPath,
            folder: toPosix(path.relative(root, dir)),
            fileTitle: title,
            fileAuthor: author,
            sizeBytes: size,
            modifiedAt: info.mtime.toISOString(),
          },
        });
      }),
    );
  };
  await walk(root);
  return books.sort((a, b) => a.relPath.localeCompare(b.relPath));
};

interface StoredIndex {
  version: 1;
  books: LibraryIndex;
}

const indexFile = (dataDir: string) => path.join(/*turbopackIgnore: true*/ dataDir, "library.json");

/**
 * Lists the books folder, then gives each file its id from library.json. The index is read and written
 * inside its queue, so concurrent scans each reconcile against the one before.
 */
const identify = async (root: string, dataDir: string): Promise<LibraryBook[]> => {
  const files = await walkLibrary(root);
  const file = indexFile(dataDir);
  return serialized(file, async () => {
    const stored = await readJson<StoredIndex>(file);
    const { index, books, changed } = reconcile(stored?.books ?? null, files);
    if (changed) await writeFileAtomic(file, JSON.stringify({ version: 1, books: index } satisfies StoredIndex, null, 2) + "\n");
    return books.map(({ id, file: { book } }) => ({ id, ...book }));
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

/** Plain words for why the books folder can't be listed, for the library and book pages alike. */
export const libraryProblem = (error: unknown, root?: string): string => {
  if (error instanceof ConfigError) return error.message;
  const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
  return missing
    ? `The books folder ${root ?? getConfig().booksDir} does not exist. Check the books folder under Folders, or BOOKS_DIR in .env.local.`
    : "The books folder could not be read. Check the books folder under Folders, or BOOKS_DIR in .env.local.";
};
