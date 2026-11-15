import { createHash } from "node:crypto";
import { appendFile, chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backfillHashes, bookIdOf, scanLibrary } from "@/lib/server/library";
import type { LibraryIndex } from "@/lib/server/library-index";

/* Every file the library reads to hash it, so a test can tell which scans read book bytes. */
const reads = vi.hoisted(() => [] as string[]);
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const createReadStream = ((...args: Parameters<typeof fs.createReadStream>) => {
    reads.push(String(args[0]));
    return fs.createReadStream(...args);
  }) as typeof fs.createReadStream;
  return { ...fs, default: { ...fs, createReadStream }, createReadStream };
});

/* Every file the library writes atomically, so a test can count index writes. */
const writes = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/server/store", async (importOriginal) => {
  const store = await importOriginal<typeof import("@/lib/server/store")>();
  return {
    ...store,
    writeFileAtomic: (file: string, content: string | Uint8Array) => {
      writes.push(file);
      return store.writeFileAtomic(file, content);
    },
  };
});

const tempDir = () => mkdtemp(path.join(tmpdir(), "rigg-learn-hashes-"));
const indexPath = (dataDir: string) => path.join(dataDir, "library.json");
const storedBooks = async (dataDir: string): Promise<LibraryIndex> =>
  (JSON.parse(await readFile(indexPath(dataDir), "utf8")) as { books: LibraryIndex }).books;
const sha256 = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
/* Filtered by folder, because a background run a previous test started may still be reading its own books. */
const readsIn = (books: string) => reads.filter((file) => file.startsWith(books + path.sep)).map((file) => path.relative(books, file));

/** A books folder holding each name with its own bytes, scanned once and fully hashed. */
const hashedShelf = async (files: Record<string, string>) => {
  const books = await tempDir();
  const data = await tempDir();
  for (const [name, bytes] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(books, name)), { recursive: true });
    await writeFile(path.join(books, name), bytes);
  }
  await scanLibrary(books, data);
  await backfillHashes(books, data);
  reads.length = 0;
  return { books, data };
};

const idsByPath = async (books: string, data: string) =>
  Object.fromEntries((await scanLibrary(books, data)).map((book) => [book.relPath, book.id]));

/* A copy then a delete, in that order, so the copy can never be handed the original's freed inode. */
const copyThenDelete = async (books: string, from: string, to: string) => {
  await mkdir(path.dirname(path.join(books, to)), { recursive: true });
  await copyFile(path.join(books, from), path.join(books, to));
  await rm(path.join(books, from));
};

beforeEach(() => {
  reads.length = 0;
});

describe("background hashing", () => {
  it("fills in the hash of every book a scan finds", async () => {
    const books = await tempDir();
    const data = await tempDir();
    await writeFile(path.join(books, "a.epub"), "alpha");
    await mkdir(path.join(books, "Shelf"));
    await writeFile(path.join(books, "Shelf", "b.pdf"), "bravo");
    await scanLibrary(books, data);
    expect(Object.values(await storedBooks(data)).map((entry) => entry.sha256)).toEqual([null, null]);
    await backfillHashes(books, data);
    const index = await storedBooks(data);
    expect(index[bookIdOf("a.epub")].sha256).toBe(sha256("alpha"));
    expect(index[bookIdOf("Shelf/b.pdf")].sha256).toBe(sha256("bravo"));
    expect(readsIn(books).sort()).toEqual(["Shelf/b.pdf", "a.epub"]);
  });

  it("reads nothing on a steady scan once every book is hashed", async () => {
    const { books, data } = await hashedShelf({ "a.epub": "alpha", "b.pdf": "bravo" });
    const before = await readFile(indexPath(data), "utf8");
    await scanLibrary(books, data);
    await backfillHashes(books, data);
    expect(readsIn(books)).toEqual([]);
    expect(await readFile(indexPath(data), "utf8")).toBe(before);
  });

  it("drops a hash when the file changed while it was read", async () => {
    const { books, data } = await hashedShelf({ "a.epub": "alpha" });
    const id = bookIdOf("a.epub");
    const index = await storedBooks(data);
    index[id] = { ...index[id], sha256: null };
    await writeFile(indexPath(data), JSON.stringify({ version: 1, books: index }));
    await backfillHashes(books, data, async (absPath) => {
      await appendFile(absPath, " and more");
      return "f".repeat(64);
    });
    expect((await storedBooks(data))[id].sha256).toBeNull();
  });

  it("drops a hash when a scan moved the book's entry while its file was read", async () => {
    const { books, data } = await hashedShelf({ "a.epub": "alpha" });
    const id = bookIdOf("a.epub");
    const index = await storedBooks(data);
    index[id] = { ...index[id], sha256: null };
    await writeFile(indexPath(data), JSON.stringify({ version: 1, books: index }));
    await backfillHashes(books, data, async (absPath) => {
      await rename(absPath, path.join(books, "renamed.epub"));
      await scanLibrary(books, data);
      await rename(path.join(books, "renamed.epub"), absPath);
      return "f".repeat(64);
    });
    expect((await storedBooks(data))[id]).toMatchObject({ relPath: "renamed.epub", sha256: null });
  });

  it("logs a failed hash and leaves the scan and the index alone", async () => {
    const { books, data } = await hashedShelf({ "a.epub": "alpha" });
    const id = bookIdOf("a.epub");
    const index = await storedBooks(data);
    index[id] = { ...index[id], sha256: null };
    await writeFile(indexPath(data), JSON.stringify({ version: 1, books: index }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await backfillHashes(books, data, () => Promise.reject(new Error("disk went away")));
      expect(warn).toHaveBeenCalledOnce();
      expect((await storedBooks(data))[id].sha256).toBeNull();
      expect(await idsByPath(books, data)).toEqual({ "a.epub": id });
    } finally {
      warn.mockRestore();
    }
  });

  it("runs once per library however many scans start it", async () => {
    const books = await tempDir();
    const data = await tempDir();
    await writeFile(path.join(books, "a.epub"), "alpha");
    await Promise.all(Array.from({ length: 6 }, () => scanLibrary(books, data)));
    await backfillHashes(books, data);
    expect(readsIn(books)).toEqual(["a.epub"]);
  });

  it("saves the hashes of a large library in a few index writes", async () => {
    const books = await tempDir();
    const data = await tempDir();
    const count = 60;
    for (let n = 0; n < count; n++) await writeFile(path.join(books, `book ${n}.epub`), `bytes of book ${n}`);
    writes.length = 0;
    await scanLibrary(books, data);
    await backfillHashes(books, data);
    const index = await storedBooks(data);
    expect(Object.values(index).filter((entry) => entry.sha256 !== null)).toHaveLength(count);
    expect(readsIn(books)).toHaveLength(count);
    const indexWrites = writes.filter((file) => file === indexPath(data)).length;
    expect(indexWrites).toBeGreaterThanOrEqual(2);
    expect(indexWrites).toBeLessThanOrEqual(Math.ceil(count / 25) + 2);
  });

  /* Root reads a file whatever its mode, so the file would never fail. */
  it.skipIf(process.getuid?.() === 0)("tries a file that cannot be read once per version, and logs it once", async () => {
    const books = await tempDir();
    const data = await tempDir();
    const locked = path.join(books, "locked.epub");
    await writeFile(locked, "alpha");
    await writeFile(path.join(books, "open.epub"), "bravo");
    await chmod(locked, 0o000);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (let scan = 0; scan < 2; scan++) {
        await scanLibrary(books, data);
        await backfillHashes(books, data);
      }
      expect(readsIn(books).filter((file) => file === "locked.epub")).toHaveLength(1);
      expect(warn).toHaveBeenCalledOnce();
      expect((await storedBooks(data))[bookIdOf("open.epub")].sha256).toBe(sha256("bravo"));

      await utimes(locked, new Date(), new Date(Date.now() + 60_000));
      await scanLibrary(books, data);
      await backfillHashes(books, data);
      expect(readsIn(books).filter((file) => file === "locked.epub")).toHaveLength(2);
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
      await chmod(locked, 0o644);
    }
  });
});

describe("matching by content hash during a scan", () => {
  it("keeps the id of a book copied to a new path and deleted from the old one (new inode, same bytes)", async () => {
    const { books, data } = await hashedShelf({ "a.pdf": "alpha", "b.epub": "bravo!" });
    const before = await stat(path.join(books, "a.pdf"));
    await copyThenDelete(books, "a.pdf", "Other Drive/a.pdf");
    expect((await stat(path.join(books, "Other Drive", "a.pdf"))).ino).not.toBe(before.ino);
    expect(await idsByPath(books, data)).toEqual({ "Other Drive/a.pdf": bookIdOf("a.pdf"), "b.epub": bookIdOf("b.epub") });
    expect(readsIn(books)).toEqual(["Other Drive/a.pdf"]);
    expect((await storedBooks(data))[bookIdOf("a.pdf")]).toMatchObject({
      relPath: "Other Drive/a.pdf",
      sha256: sha256("alpha"),
      missingSince: null,
    });
  });

  it("keeps the id of a book saved again as a new file at a new path", async () => {
    const { books, data } = await hashedShelf({ "a.epub": "alpha" });
    await writeFile(path.join(books, "a (saved).epub"), "alpha");
    await rm(path.join(books, "a.epub"));
    expect(await idsByPath(books, data)).toEqual({ "a (saved).epub": bookIdOf("a.epub") });
  });

  it("binds neither of two identical copies of a moved book", async () => {
    const { books, data } = await hashedShelf({ "a.epub": "alpha" });
    await copyFile(path.join(books, "a.epub"), path.join(books, "one.epub"));
    await copyThenDelete(books, "a.epub", "two.epub");
    const ids = await idsByPath(books, data);
    expect(Object.keys(ids).sort()).toEqual(["one.epub", "two.epub"]);
    expect(Object.values(ids)).not.toContain(bookIdOf("a.epub"));
    const orphan = (await storedBooks(data))[bookIdOf("a.epub")];
    expect(orphan).toMatchObject({ relPath: "a.epub", sha256: sha256("alpha") });
    expect(orphan.missingSince).toEqual(expect.any(Number));
  });

  it("gives a book moved and edited a new id and leaves the old one orphaned", async () => {
    const { books, data } = await hashedShelf({ "a.epub": "alpha" });
    await writeFile(path.join(books, "edited.epub"), "ALPHA");
    await rm(path.join(books, "a.epub"));
    const id = (await idsByPath(books, data))["edited.epub"];
    expect(id).not.toBe(bookIdOf("a.epub"));
    const index = await storedBooks(data);
    expect(index[id].sha256).toBe(sha256("ALPHA"));
    expect(index[bookIdOf("a.epub")].missingSince).toEqual(expect.any(Number));
  });

  it("does not read a new file of a size no orphan has", async () => {
    const { books, data } = await hashedShelf({ "a.epub": "alpha", "b.epub": "bravo" });
    await rm(path.join(books, "a.epub"));
    await scanLibrary(books, data);
    await writeFile(path.join(books, "new.epub"), "a longer book");
    await scanLibrary(books, data);
    expect(readsIn(books)).toEqual([]);
  });
});
