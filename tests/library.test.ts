import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { cleanFileTitle } from "@/lib/server/filename";
import { bookIdOf, findBook, scanLibrary } from "@/lib/server/library";

describe("cleanFileTitle", () => {
  it("drops the z-library mirror list", () => {
    expect(cleanFileTitle("Dune (Frank Herbert) (z-library.sk, 1lib.sk, z-lib.sk).epub")).toBe("Dune (Frank Herbert)");
  });

  it("drops the Anna's Archive tail and restores colons", () => {
    expect(
      cleanFileTitle(
        "Generative AI Design Patterns_ Solutions to Common -- Valliappa Lakshmanan, Hannes Hapke -- 2025 -- O'Reilly Media -- isbn13 9788341622662 -- b27e81bb7bfead59cf5572d25b89a5ad -- Anna’s Archive.pdf",
      ),
    ).toBe("Generative AI Design Patterns: Solutions to Common");
  });

  it("joins a spaced underscore as a colon and collapses spaces", () => {
    expect(cleanFileTitle("The Adweek Copywriting Handbook _ The Ultimate  Guide -- Joseph Sugarman -- 2012.epub")).toBe(
      "The Adweek Copywriting Handbook: The Ultimate Guide",
    );
  });

  it("leaves a plain name alone", () => {
    expect(cleanFileTitle("The Founder's Dilemmas.epub")).toBe("The Founder's Dilemmas");
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
});
