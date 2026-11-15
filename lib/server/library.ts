import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { BookFormat, BookId, LibraryBook } from "@/lib/shared/types";
import { ConfigError, getConfig } from "./config";
import { parseFileName } from "./filename";

const FORMATS: Record<string, BookFormat> = { ".epub": "epub", ".pdf": "pdf" };

export const bookIdOf = (relPath: string): BookId =>
  createHash("sha1").update(relPath).digest("hex") as BookId;

export const isBookId = (value: unknown): value is BookId =>
  typeof value === "string" && /^[0-9a-f]{40}$/.test(value);

const toPosix = (relPath: string) => relPath.split(path.sep).join("/");

const walkLibrary = async (root: string): Promise<LibraryBook[]> => {
  const books: LibraryBook[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.name.startsWith(".")) return;
        const absPath = path.join(/*turbopackIgnore: true*/ dir, entry.name);
        if (entry.isDirectory()) return walk(absPath);
        const format = FORMATS[path.extname(entry.name).toLowerCase()];
        if (!entry.isFile() || !format) return;
        const info = await stat(absPath);
        const relPath = toPosix(path.relative(root, absPath));
        const { title, author } = parseFileName(entry.name);
        books.push({
          id: bookIdOf(relPath),
          format,
          relPath,
          folder: toPosix(path.relative(root, dir)),
          fileTitle: title,
          fileAuthor: author,
          sizeBytes: info.size,
          modifiedAt: info.mtime.toISOString(),
        });
      }),
    );
  };
  await walk(root);
  return books.sort((a, b) => a.relPath.localeCompare(b.relPath));
};

/* Every cover, saved position and chat turn looks its book up, so a scan is reused for a few seconds.
   The cache lives on globalThis because dev bundles each route separately. */
const SCAN_TTL_MS = 5000;
interface Scan {
  at: number;
  books: Promise<LibraryBook[]>;
}
const scans = ((globalThis as { [key: symbol]: unknown })[Symbol.for("rigg-learn.library-scans")] ??= new Map()) as Map<string, Scan>;

const freshScan = (root: string): Scan | null => {
  const scan = scans.get(path.resolve(root));
  return scan && Date.now() - scan.at < SCAN_TTL_MS ? scan : null;
};

const rescan = (root: string): Promise<LibraryBook[]> => {
  const key = path.resolve(root);
  const scan: Scan = { at: Date.now(), books: walkLibrary(root) };
  scans.set(key, scan);
  scan.books.catch(() => {
    if (scans.get(key) === scan) scans.delete(key);
  });
  return scan.books;
};

/** Every EPUB and PDF under `root`, depth first, read from disk now. Hidden files and folders are skipped. */
export const scanLibrary = async (root: string = getConfig().booksDir): Promise<LibraryBook[]> => [...(await rescan(root))];

export interface FoundBook {
  book: LibraryBook;
  absPath: string;
}

/**
 * The only way to turn a request into a file path. The id must match a book
 * the scan found, so a crafted id can never name a file outside BOOKS_DIR.
 */
export const findBook = async (id: unknown, root: string = getConfig().booksDir): Promise<FoundBook | null> => {
  if (!isBookId(id)) return null;
  const cached = freshScan(root);
  const byId = (books: LibraryBook[]) => books.find((candidate) => candidate.id === id);
  /* A book added since the cached scan is found by looking again once. */
  const book = (cached && byId(await cached.books)) || byId(await rescan(root));
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
