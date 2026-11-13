import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseFileName } from "@/lib/server/filename";
import { bookIdOf, findBook, scanLibrary } from "@/lib/server/library";

describe("parseFileName", () => {
  it("moves a trailing author parenthetical into the author line", () => {
    expect(parseFileName("AI Engineering (Chip Huyen) (z-library.sk, 1lib.sk, z-lib.sk).epub")).toEqual({
      title: "AI Engineering",
      author: "Chip Huyen",
    });
    expect(parseFileName("LOGO Modernism (Jens Müller, R. Roger Remington) (z-library.sk, 1lib.sk, z-lib.sk).pdf")).toEqual({
      title: "LOGO Modernism",
      author: "Jens Müller, R. Roger Remington",
    });
  });

  it("keeps edition tags in the title and takes only the names", () => {
    expect(
      parseFileName("AI Engineering in Practice (MEAP) (Richard Davies, Rafael Fischer) (z-library.sk, 1lib.sk, z-lib.sk).pdf"),
    ).toEqual({ title: "AI Engineering in Practice (MEAP)", author: "Richard Davies, Rafael Fischer" });
    expect(
      parseFileName("Beyond Good and Evil (AmazonClassics Edition) (Nietzsche, Friedrich) (z-library.sk, 1lib.sk, z-lib.sk).epub"),
    ).toEqual({ title: "Beyond Good and Evil (AmazonClassics Edition)", author: "Friedrich Nietzsche" });
    expect(
      parseFileName("Fine-Tuning AI (for Raymond Rhine) (First Early Release) (Laurence Moroney) (z-library.sk, 1lib.sk, z-lib.sk).pdf"),
    ).toEqual({ title: "Fine-Tuning AI (for Raymond Rhine) (First Early Release)", author: "Laurence Moroney" });
  });

  it("puts a last-name-first author's first name first", () => {
    expect(parseFileName("Good StrategyBad Strategy (Rumelt, Richard) (z-library.sk, 1lib.sk, z-lib.sk).epub")).toEqual({
      title: "Good StrategyBad Strategy",
      author: "Richard Rumelt",
    });
  });

  it("reads names in the decomposed Unicode that macOS file names use", () => {
    const decomposed = "LOGO Modernism (Jens Mu\u0308ller, R. Roger Remington) (z-library.sk, 1lib.sk, z-lib.sk).pdf";
    expect(parseFileName(decomposed)).toEqual({ title: "LOGO Modernism", author: "Jens Müller, R. Roger Remington" });
  });

  it("reads a single trailing ' - Author', but not a title with several dashes", () => {
    expect(parseFileName("SPIN Selling_ Situation Problem Implication Need-payoff - Neil Rackham.epub")).toEqual({
      title: "SPIN Selling: Situation Problem Implication Need-payoff",
      author: "Neil Rackham",
    });
    expect(parseFileName("Herbert, Frank - Dune 02 - Dune Messiah (Herbert, Frank) (z-library.sk, 1lib.sk, z-lib.sk).epub")).toEqual({
      title: "Herbert, Frank - Dune 02 - Dune Messiah",
      author: "Frank Herbert",
    });
    expect(parseFileName("Dune - Part Two.epub")).toEqual({ title: "Dune - Part Two", author: null });
  });

  it("reads a name that uses underscores for spaces and drops the site watermark", () => {
    expect(parseFileName("_OceanofPDF.com_Click_Here_The_Art_of_Digital_Marketing_-_Alex_Schultz.epub")).toEqual({
      title: "Click Here The Art of Digital Marketing",
      author: "Alex Schultz",
    });
  });

  it("leaves a parenthetical that is not a person in the title", () => {
    expect(parseFileName("Build a Large Language Model (From Scratch).epub")).toEqual({
      title: "Build a Large Language Model (From Scratch)",
      author: null,
    });
    expect(parseFileName("Notes (MEAP).pdf")).toEqual({ title: "Notes (MEAP)", author: null });
    expect(parseFileName("Trademarks and Symbols (Vol 2).pdf")).toEqual({ title: "Trademarks and Symbols (Vol 2)", author: null });
  });

  it("reads the Anna's Archive form: colons restored, author from the second part", () => {
    expect(
      parseFileName(
        "Generative AI Design Patterns_ Solutions to Common -- Valliappa Lakshmanan, Hannes Hapke -- 2025 -- O'Reilly Media -- isbn13 9788341622662 -- b27e81bb7bfead59cf5572d25b89a5ad -- Anna’s Archive.pdf",
      ),
    ).toEqual({ title: "Generative AI Design Patterns: Solutions to Common", author: "Valliappa Lakshmanan, Hannes Hapke" });
    expect(
      parseFileName(
        "The E-Myth Revisited_ Why Most Small Businesses Don't Work -- Michael E_ Gerber -- 2009 -- HarperCollins -- 6b8fc42014ceb2a27379c4c8ec82dfc9 -- Anna’s Archive.epub",
      ),
    ).toEqual({ title: "The E-Myth Revisited: Why Most Small Businesses Don't Work", author: "Michael E. Gerber" });
    expect(
      parseFileName(
        "Plato_ Republic -- Plato; Joe Sachs; John White -- Hackett Publishing Company, Newburyport, MA, 2007 -- Hackett -- isbn13 9781585102617 -- ebcb5167b1059c0de94dcbfac035fc29 -- Anna’s Archive.epub",
      ),
    ).toEqual({ title: "Plato: Republic", author: "Plato, Joe Sachs, John White" });
  });

  it("tidies messy archive author lists", () => {
    const author = (segment: string) => parseFileName(`Title -- ${segment} -- 2020 -- Anna’s Archive.epub`).author;
    expect(author("Engle, Greg;Fried, Jason;Moesta, Bob")).toBe("Greg Engle, Jason Fried, Bob Moesta");
    expect(author("Eugene M_ Schwartz, Eugene Schwartz, eugene m_ schwartz,")).toBe("Eugene M. Schwartz, Eugene Schwartz");
    expect(author("edited by Arthur P_ Shimamura")).toBe("Arthur P. Shimamura");
  });

  it("drops the dangling 'and' or comma the '--' split leaves behind", () => {
    expect(
      parseFileName(
        "Designing Multi-Agent Systems_ Principles, Patterns, and -- Victor Dibia -- 2025 -- cfe9d57d685be87e1ca934457e8b0d32 -- Anna’s Archive.epub",
      ).title,
    ).toBe("Designing Multi-Agent Systems: Principles, Patterns");
    expect(
      parseFileName(
        "Practical LLM Evaluation for Production Systems_ Measure, -- Ammar Mohanna, Indrajit Kar, Zonunfeli Ralte -- 1, 2026 -- Packt Publishing -- isbn13 9781807423896 -- 601cde8e5b7e26319573c42e8d8002c5 -- Anna’s Archive.pdf",
      ).title,
    ).toBe("Practical LLM Evaluation for Production Systems: Measure");
    expect(parseFileName("The Adweek Copywriting Handbook _ The Ultimate Guide to -- Joseph Sugarman -- 2012.epub").title).toBe(
      "The Adweek Copywriting Handbook: The Ultimate Guide",
    );
  });

  it("joins a spaced underscore as a colon and collapses spaces", () => {
    expect(parseFileName("The Adweek Copywriting Handbook _ The Ultimate  Guide -- Joseph Sugarman -- 2012.epub").title).toBe(
      "The Adweek Copywriting Handbook: The Ultimate Guide",
    );
  });

  it("leaves a plain name alone", () => {
    expect(parseFileName("The Founder's Dilemmas.epub")).toEqual({ title: "The Founder's Dilemmas", author: null });
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
