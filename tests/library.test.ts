import { link, mkdir, mkdtemp, readFile, rename, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { parseFileName } from "@/lib/server/filename";
import { backfillHashes, bookIdOf, findBook, libraryProblem, scanLibrary } from "@/lib/server/library";
import { LibraryIndexError, readIndex, type LibraryIndex } from "@/lib/server/library-index";
import type { BookId } from "@/lib/shared/types";

const tempDir = () => mkdtemp(path.join(tmpdir(), "rigg-learn-library-"));
const indexPath = (dataDir: string) => path.join(dataDir, "library.json");
const storedBooks = async (dataDir: string): Promise<LibraryIndex> =>
  (JSON.parse(await readFile(indexPath(dataDir), "utf8")) as { books: LibraryIndex }).books;

describe("parseFileName", () => {
  it("moves a trailing author parenthetical into the author line", () => {
    expect(parseFileName("Gardening for Robots (Alma Quill) (example.org, books.example, mirror.example.net).epub")).toEqual({
      title: "Gardening for Robots",
      author: "Alma Quill",
    });
    expect(parseFileName("Poster Geometry (Lena Brandt, R. Dale Whitcombe) (example.org, books.example, mirror.example.net).pdf")).toEqual({
      title: "Poster Geometry",
      author: "Lena Brandt, R. Dale Whitcombe",
    });
  });

  it("keeps edition tags in the title and takes only the names", () => {
    expect(
      parseFileName("Practical Tide Tables (MEAP) (Owen Marsh, Petra Lindqvist) (example.org, books.example, mirror.example.net).pdf"),
    ).toEqual({ title: "Practical Tide Tables (MEAP)", author: "Owen Marsh, Petra Lindqvist" });
    expect(
      parseFileName("Meditations on Lanterns (Example Classics Edition) (Voss, Marcus) (example.org, books.example, mirror.example.net).epub"),
    ).toEqual({ title: "Meditations on Lanterns (Example Classics Edition)", author: "Marcus Voss" });
    expect(
      parseFileName("Learning Kites (for Jane Example) (First Early Release) (Tamsin Ridley) (example.org, books.example, mirror.example.net).pdf"),
    ).toEqual({ title: "Learning Kites (for Jane Example) (First Early Release)", author: "Tamsin Ridley" });
  });

  it("puts a last-name-first author's first name first", () => {
    expect(parseFileName("Orchard StrategyBad Orchard (Hallett, Nora) (example.org, books.example, mirror.example.net).epub")).toEqual({
      title: "Orchard StrategyBad Orchard",
      author: "Nora Hallett",
    });
  });

  it("reads names in the decomposed Unicode that macOS file names use", () => {
    const decomposed = "Poster Geometry (Lena Bra\u0308ndt, R. Dale Whitcombe) (example.org, books.example, mirror.example.net).pdf";
    expect(parseFileName(decomposed)).toEqual({ title: "Poster Geometry", author: "Lena Brändt, R. Dale Whitcombe" });
  });

  it("reads a single trailing ' - Author', but not a title with several dashes", () => {
    expect(parseFileName("Closing Deals_ Listen Probe Propose Need-payoff - Ivan Calloway.epub")).toEqual({
      title: "Closing Deals: Listen Probe Propose Need-payoff",
      author: "Ivan Calloway",
    });
    expect(
      parseFileName("Fenwick, Alder - Saga 02 - Saga Rising (Fenwick, Alder) (example.org, books.example, mirror.example.net).epub"),
    ).toEqual({
      title: "Fenwick, Alder - Saga 02 - Saga Rising",
      author: "Alder Fenwick",
    });
    expect(parseFileName("Saga - Part Two.epub")).toEqual({ title: "Saga - Part Two", author: null });
  });

  it("reads a name that uses underscores for spaces and drops the site watermark", () => {
    expect(parseFileName("_Site.com_Click_Here_The_Art_of_Quiet_Mornings_-_Mira_Okafor.epub")).toEqual({
      title: "Click Here The Art of Quiet Mornings",
      author: "Mira Okafor",
    });
    expect(parseFileName("Node.js_Recipes_-_Sam_Rowe.epub").title).toBe("Node.js Recipes");
  });

  it("leaves a parenthetical that is not a person in the title", () => {
    expect(parseFileName("Build a Tiny Compiler (From Scratch).epub")).toEqual({
      title: "Build a Tiny Compiler (From Scratch)",
      author: null,
    });
    expect(parseFileName("Field Notes (MEAP).pdf")).toEqual({ title: "Field Notes (MEAP)", author: null });
    expect(parseFileName("Maps and Symbols (Vol 2).pdf")).toEqual({ title: "Maps and Symbols (Vol 2)", author: null });
  });

  it("reads the dash-separated catalogue form: colons restored, author from the second part", () => {
    expect(
      parseFileName(
        "Cooking Pattern Languages_ Solutions to Common -- Ingrid Valmont, Hugo Pellerin -- 2025 -- Example Press -- isbn13 9780000000002 -- 0123456789abcdef0123456789abcdef -- books.example.pdf",
      ),
    ).toEqual({ title: "Cooking Pattern Languages: Solutions to Common", author: "Ingrid Valmont, Hugo Pellerin" });
    expect(
      parseFileName(
        "The Bakery Myth_ Why Most Small Ovens Don't Work -- Clara F_ Winthrop -- 2009 -- Example Press -- 0123456789abcdef0123456789abcdef -- books.example.epub",
      ),
    ).toEqual({ title: "The Bakery Myth: Why Most Small Ovens Don't Work", author: "Clara F. Winthrop" });
    expect(
      parseFileName(
        "Sophia_ Dialogues -- Sophia; Tobias Reed; Edith Hart -- Example Publishing Company, Springfield, MA, 2007 -- Example -- isbn13 9780000000019 -- 0123456789abcdef0123456789abcdef -- books.example.epub",
      ),
    ).toEqual({ title: "Sophia: Dialogues", author: "Sophia, Tobias Reed, Edith Hart" });
  });

  it("tidies messy catalogue author lists", () => {
    const author = (segment: string) => parseFileName(`Title -- ${segment} -- 2020 -- books.example.epub`).author;
    expect(author("Ashby, Dina;Lowe, Felix;Quinn, Milo")).toBe("Dina Ashby, Felix Lowe, Milo Quinn");
    expect(author("Rosa B_ Calder, Rosa Calder, rosa b_ calder,")).toBe("Rosa B. Calder, Rosa Calder");
    expect(author("edited by Wesley Q_ Harmon")).toBe("Wesley Q. Harmon");
  });

  it("drops the dangling 'and' or comma the '--' split leaves behind", () => {
    expect(
      parseFileName(
        "Designing Lighthouse Networks_ Principles, Patterns, and -- Viktor Alder -- 2025 -- 0123456789abcdef0123456789abcdef -- books.example.epub",
      ).title,
    ).toBe("Designing Lighthouse Networks: Principles, Patterns");
    expect(
      parseFileName(
        "Practical Kiln Testing for Studios_ Measure, -- Ada Penrose, Idris Vale, Zora Nkemelu -- 1, 2026 -- Example Press -- isbn13 9780000000026 -- 0123456789abcdef0123456789abcdef -- books.example.pdf",
      ).title,
    ).toBe("Practical Kiln Testing for Studios: Measure");
    expect(parseFileName("The Pennant Writing Handbook _ The Ultimate Guide to -- Jonas Whitlock -- 2012.epub").title).toBe(
      "The Pennant Writing Handbook: The Ultimate Guide",
    );
  });

  it("joins a spaced underscore as a colon and collapses spaces", () => {
    expect(parseFileName("The Pennant Writing Handbook _ The Ultimate  Guide -- Jonas Whitlock -- 2012.epub").title).toBe(
      "The Pennant Writing Handbook: The Ultimate Guide",
    );
  });

  it("leaves a plain name alone", () => {
    expect(parseFileName("The Cartographer's Dilemmas.epub")).toEqual({ title: "The Cartographer's Dilemmas", author: null });
  });
});

describe("library lookup", () => {
  let root: string;
  let outside: string;
  let data: string;

  beforeAll(async () => {
    const base = await tempDir();
    root = path.join(base, "books");
    data = path.join(base, "data");
    outside = path.join(base, "secret.pdf");
    await mkdir(path.join(root, "Fiction"), { recursive: true });
    await writeFile(path.join(root, "Fiction", "Dune.epub"), "epub");
    await writeFile(path.join(root, "notes.txt"), "not a book");
    await writeFile(outside, "outside");
  });

  it("finds a scanned book by its id", async () => {
    const found = await findBook(bookIdOf("Fiction/Dune.epub"), root, data);
    expect(found?.book.fileTitle).toBe("Dune");
    expect(found?.absPath).toBe(path.join(root, "Fiction", "Dune.epub"));
  });

  it("rejects an unknown id", async () => {
    expect(await findBook(bookIdOf("Fiction/Missing.epub"), root, data)).toBeNull();
  });

  it("finds a book added after the last scan", async () => {
    const shelf = await tempDir();
    const shelfData = await tempDir();
    await writeFile(path.join(shelf, "Dune.epub"), "epub");
    expect(await findBook(bookIdOf("Dune.epub"), shelf, shelfData)).not.toBeNull();
    await backfillHashes(shelf, shelfData);
    /* An entry already waiting at the new file's path, so its id is known before the file exists. */
    const known = "e".repeat(40) as BookId;
    /* Written without missingSince, which an index may lack and reads as present. */
    const index: Record<string, unknown> = await storedBooks(shelfData);
    index[known] = { relPath: "Emma.epub", size: 0, mtimeMs: 0, ino: "0", dev: "0", sha256: null };
    await writeFile(indexPath(shelfData), JSON.stringify({ version: 1, books: index }));
    await writeFile(path.join(shelf, "Emma.epub"), "epub");
    expect((await findBook(known, shelf, shelfData))?.book.fileTitle).toBe("Emma");
  });

  it("rejects a path or a malformed id", async () => {
    expect(await findBook("../secret.pdf", root, data)).toBeNull();
    expect(await findBook(outside, root, data)).toBeNull();
    expect(await findBook(bookIdOf("../secret.pdf"), root, data)).toBeNull();
  });

  it("lists only books, grouped by their folder", async () => {
    const books = await scanLibrary(root, data);
    expect(books.map((book) => [book.folder, book.relPath, book.format])).toEqual([["Fiction", "Fiction/Dune.epub", "epub"]]);
  });

  it("names a missing books folder the same way on every page", async () => {
    const missing = path.join(root, "Nowhere");
    const missingData = await tempDir();
    const error = await findBook(bookIdOf("Fiction/Dune.epub"), missing, missingData).catch((cause: unknown) => cause);
    expect(libraryProblem(error, missing)).toBe(`The books folder ${missing} does not exist. Check the books folder under Folders, or BOOKS_DIR in .env.local.`);
    await expect(stat(indexPath(missingData))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("library index on disk", () => {
  const shelfWith = async (files: string[]) => {
    const books = await tempDir();
    const data = await tempDir();
    for (const name of files) {
      await mkdir(path.dirname(path.join(books, name)), { recursive: true });
      await writeFile(path.join(books, name), `bytes of ${name}`);
    }
    return { books, data };
  };
  const idsByPath = async (books: string, data: string) =>
    Object.fromEntries((await scanLibrary(books, data)).map((book) => [book.relPath, book.id]));

  it("seeds an existing library with the ids its paths gave it", async () => {
    const { books, data } = await shelfWith(["a.epub", "Shelf/b.pdf"]);
    expect(await idsByPath(books, data)).toEqual({ "a.epub": bookIdOf("a.epub"), "Shelf/b.pdf": bookIdOf("Shelf/b.pdf") });
    expect(Object.keys(await storedBooks(data)).sort()).toEqual([bookIdOf("a.epub"), bookIdOf("Shelf/b.pdf")].sort());
  });

  it("keeps a book's id across scans after it is moved and renamed on disk", async () => {
    const { books, data } = await shelfWith(["a.epub", "b.pdf"]);
    await scanLibrary(books, data);
    await mkdir(path.join(books, "Shelf"));
    await rename(path.join(books, "a.epub"), path.join(books, "Shelf", "renamed.epub"));
    expect(await idsByPath(books, data)).toEqual({ "Shelf/renamed.epub": bookIdOf("a.epub"), "b.pdf": bookIdOf("b.pdf") });
    expect((await findBook(bookIdOf("a.epub"), books, data))?.absPath).toBe(path.join(books, "Shelf", "renamed.epub"));
    await rename(path.join(books, "Shelf", "renamed.epub"), path.join(books, "again.epub"));
    expect((await idsByPath(books, data))["again.epub"]).toBe(bookIdOf("a.epub"));
    expect((await storedBooks(data))[bookIdOf("a.epub")].relPath).toBe("again.epub");
  });

  it("gives a book added after seeding a new random id", async () => {
    const { books, data } = await shelfWith(["a.epub"]);
    await scanLibrary(books, data);
    await writeFile(path.join(books, "b.epub"), "new");
    const id = (await idsByPath(books, data))["b.epub"];
    expect(id).toMatch(/^[0-9a-f]{40}$/);
    expect(id).not.toBe(bookIdOf("b.epub"));
    expect((await findBook(id, books, data))?.book.relPath).toBe("b.epub");
  });

  it("does not rewrite the index when nothing changed", async () => {
    const { books, data } = await shelfWith(["a.epub"]);
    await scanLibrary(books, data);
    await backfillHashes(books, data);
    const before = await stat(indexPath(data));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await scanLibrary(books, data);
    await backfillHashes(books, data);
    const after = await stat(indexPath(data));
    expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
  });

  it("leaves the index alone when the books folder turns up empty", async () => {
    const { books, data } = await shelfWith(["a.epub"]);
    await scanLibrary(books, data);
    await backfillHashes(books, data);
    const text = await readFile(indexPath(data), "utf8");
    expect(await scanLibrary(await tempDir(), data)).toEqual([]);
    expect(await readFile(indexPath(data), "utf8")).toBe(text);
  });

  it("writes no index from an empty first scan", async () => {
    const { books, data } = await shelfWith([]);
    expect(await scanLibrary(books, data)).toEqual([]);
    await expect(stat(indexPath(data))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the index whole and every id unique under concurrent scans", async () => {
    const names = Array.from({ length: 8 }, (_, n) => `book ${n}.epub`);
    const { books, data } = await shelfWith(names);
    await scanLibrary(books, data);
    const scans = Array.from({ length: 6 }, () => scanLibrary(books, data));
    await rename(path.join(books, "book 0.epub"), path.join(books, "moved.epub"));
    scans.push(...Array.from({ length: 6 }, () => scanLibrary(books, data)));
    await Promise.all(scans);
    const ids = await idsByPath(books, data);
    expect(ids["moved.epub"]).toBe(bookIdOf("book 0.epub"));
    expect(new Set(Object.values(ids)).size).toBe(names.length);
    const index = await storedBooks(data);
    expect(Object.keys(index)).toHaveLength(names.length);
    expect(index[bookIdOf("book 0.epub")].relPath).toBe("moved.epub");
  });

  it("gives a new book one id however many scans find it at once", async () => {
    const { books, data } = await shelfWith(["a.epub"]);
    await scanLibrary(books, data);
    await writeFile(path.join(books, "new.epub"), "new");
    const scans = await Promise.all(Array.from({ length: 12 }, () => scanLibrary(books, data)));
    const ids = new Set(scans.map((found) => found.find((book) => book.relPath === "new.epub")?.id));
    expect(ids.size).toBe(1);
    const entries = Object.entries(await storedBooks(data)).filter(([, entry]) => entry.relPath === "new.epub");
    expect(entries.map(([id]) => id)).toEqual([...ids]);
  });

  describe("an index that cannot be read", () => {
    const cases: [string, string][] = [
      ["is not JSON", "{ not json"],
      ["has another version", JSON.stringify({ version: 2, books: {} })],
      ["has no books object", JSON.stringify({ version: 1, books: [] })],
      ["has an entry with a wrong field type", JSON.stringify({ version: 1, books: { ["a".repeat(40)]: { relPath: 3 } } })],
      ["has a key that is not an id", JSON.stringify({ version: 1, books: { "a.epub": {} } })],
    ];
    it.each(cases)("stops the scan and leaves the file alone when it %s", async (_, text) => {
      const { books, data } = await shelfWith(["a.epub"]);
      await writeFile(indexPath(data), text);
      await expect(readIndex(indexPath(data))).rejects.toBeInstanceOf(LibraryIndexError);
      const error = await scanLibrary(books, data).catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(LibraryIndexError);
      expect(libraryProblem(error)).toMatch(/^The saved library index in the data folder .* can't be read, so nothing was changed\./);
      expect(await readFile(indexPath(data), "utf8")).toBe(text);
    });
  });

  it("lists a hard-linked book once and reports the other path once", async () => {
    const { books, data } = await shelfWith(["a.epub"]);
    await scanLibrary(books, data);
    await link(path.join(books, "a.epub"), path.join(books, "z link.epub"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await idsByPath(books, data)).toEqual({ "a.epub": bookIdOf("a.epub") });
      expect(await idsByPath(books, data)).toEqual({ "a.epub": bookIdOf("a.epub") });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("z link.epub");
    } finally {
      warn.mockRestore();
    }
  });

  it("reads no index as none yet", async () => {
    expect(await readIndex(indexPath(await tempDir()))).toBeNull();
  });
});
