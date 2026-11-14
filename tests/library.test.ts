import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseFileName } from "@/lib/server/filename";
import { bookIdOf, findBook, libraryProblem, scanLibrary } from "@/lib/server/library";

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

  beforeAll(async () => {
    const base = await mkdtemp(path.join(tmpdir(), "rigg-learn-library-"));
    root = path.join(base, "books");
    outside = path.join(base, "secret.pdf");
    await mkdir(path.join(root, "Fiction"), { recursive: true });
    await writeFile(path.join(root, "Fiction", "Dune.epub"), "epub");
    await writeFile(path.join(root, "notes.txt"), "not a book");
    await writeFile(outside, "outside");
  });

  it("finds a scanned book by its id", async () => {
    const found = await findBook(bookIdOf("Fiction/Dune.epub"), root);
    expect(found?.book.fileTitle).toBe("Dune");
    expect(found?.absPath).toBe(path.join(root, "Fiction", "Dune.epub"));
  });

  it("rejects an unknown id", async () => {
    expect(await findBook(bookIdOf("Fiction/Missing.epub"), root)).toBeNull();
  });

  it("rejects a path or a malformed id", async () => {
    expect(await findBook("../secret.pdf", root)).toBeNull();
    expect(await findBook(outside, root)).toBeNull();
    expect(await findBook(bookIdOf("../secret.pdf"), root)).toBeNull();
  });

  it("lists only books, grouped by their folder", async () => {
    const books = await scanLibrary(root);
    expect(books.map((book) => [book.folder, book.relPath, book.format])).toEqual([["Fiction", "Fiction/Dune.epub", "epub"]]);
  });

  it("names a missing books folder the same way on every page", async () => {
    const missing = path.join(root, "Nowhere");
    const error = await findBook(bookIdOf("Fiction/Dune.epub"), missing).catch((cause: unknown) => cause);
    expect(libraryProblem(error, missing)).toBe(`The books folder ${missing} does not exist. Check the books folder under Folders, or BOOKS_DIR in .env.local.`);
  });
});
