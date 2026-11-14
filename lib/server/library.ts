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

/** Every EPUB and PDF under `root`, depth first. Hidden files and folders are skipped. */
export const scanLibrary = async (root: string = getConfig().booksDir): Promise<LibraryBook[]> => {
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
  const book = (await scanLibrary(root)).find((candidate) => candidate.id === id);
  if (!book) return null;
  const absPath = path.resolve(/*turbopackIgnore: true*/ root, book.relPath);
  if (!absPath.startsWith(path.resolve(root) + path.sep)) return null;
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
