import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderVault, vaultFileName, writeVault, type VaultBook } from "@/lib/server/vault";
import type { BookId, Highlight, Note } from "@/lib/shared/types";

const book: VaultBook = {
  id: "c7a9708c8427667f67560c06eade4af41a47400d" as BookId,
  title: "Generative AI Design Patterns: Solutions",
  author: "Valliappa Lakshmanan, Hannes Hapke",
  format: "pdf",
};

const highlight = (id: string, page: number, start: number, chapterTitle: string | null, quote: string): Highlight => ({
  id,
  anchor: { kind: "pdf", page, start, end: start + quote.length },
  quote,
  chapterTitle,
  color: "amber",
  createdAt: `2026-11-13T10:0${page % 10}:00.000Z`,
});

const highlights = [
  highlight("aaaaaaaa-1111-4111-8111-111111111111", 46, 200, "Pattern 1: Logits Masking", "Mask the logits that would break the format."),
  highlight("bbbbbbbb-2222-4222-8222-222222222222", 15, 40, "Chapter 1. Introduction", "A pattern names a problem.\n\nAnd its solution."),
  highlight("cccccccc-3333-4333-8333-333333333333", 15, 10, "Chapter 1. Introduction", "Design patterns."),
];

const note = (id: string, fields: Partial<Note>): Note => ({
  id,
  anchor: { kind: "pdf", page: 15, start: 40, end: 70 },
  quote: "A pattern names a problem.",
  chapterTitle: "Chapter 1. Introduction",
  highlightId: null,
  body: "",
  tags: [],
  createdAt: "2026-11-13T11:00:00.000Z",
  updatedAt: "2026-11-13T11:00:00.000Z",
  ...fields,
});

const notes = [
  note("dddddddd-4444-4444-8444-444444444444", {
    highlightId: "bbbbbbbb-2222-4222-8222-222222222222",
    body: "Like a recipe card. #patterns #design",
    tags: ["patterns", "design"],
  }),
  note("eeeeeeee-5555-4555-8555-555555555555", {
    anchor: { kind: "pdf", page: 50, start: 5, end: 30 },
    quote: "Its highlight was removed.",
    chapterTitle: "Pattern 2: Grammar",
    body: "- still here\n- **kept** #Patterns",
    tags: ["Patterns"],
  }),
];

describe("the Obsidian note file", () => {
  it("writes frontmatter, then chapters in reading order with block ids and notes", () => {
    expect(renderVault(book, { highlights, notes })).toBe(
      [
        "---",
        'title: "Generative AI Design Patterns: Solutions"',
        'author: "Valliappa Lakshmanan, Hannes Hapke"',
        "format: pdf",
        "bookId: c7a9708c8427667f67560c06eade4af41a47400d",
        "tags:",
        '  - "patterns"',
        '  - "design"',
        'generated: "Written by rigg learn from the highlights and notes saved in the app. Edits made here are not read back into the app yet."',
        "---",
        "",
        "## Chapter 1. Introduction",
        "",
        "> Design patterns. ^h-cccccccc",
        "",
        "> A pattern names a problem.",
        ">",
        "> And its solution. ^h-bbbbbbbb",
        "",
        "Like a recipe card. #patterns #design",
        "",
        "## Pattern 1: Logits Masking",
        "",
        "> Mask the logits that would break the format. ^h-aaaaaaaa",
        "",
        "## Pattern 2: Grammar",
        "",
        "> Its highlight was removed. ^n-eeeeeeee",
        "",
        "- still here",
        "- **kept** #Patterns",
        "",
      ].join("\n"),
    );
  });

  it("writes only the frontmatter for a book with nothing marked, and names missing chapters", () => {
    const empty = renderVault({ ...book, author: null, format: "epub" }, { highlights: [], notes: [] });
    expect(empty).toContain('author: ""\nformat: epub\n');
    expect(empty).toContain("tags: []\n");
    expect(empty.endsWith("---\n")).toBe(true);
    const loose = renderVault(book, { highlights: [highlight("ffffffff-6666-4666-8666-666666666666", 2, 0, null, "Front matter.")], notes: [] });
    expect(loose).toContain("## Untitled section\n\n> Front matter. ^h-ffffffff\n");
  });

  it("names the file after the title, without characters Obsidian or the file system reject", () => {
    expect(vaultFileName("Generative AI Design Patterns: Solutions")).toBe("Generative AI Design Patterns - Solutions.md");
    expect(vaultFileName('C# / F#? [Notes] "1" <a|b> ^x')).toBe("C F Notes 1 ab x.md");
    expect(vaultFileName("  ...  ")).toBe("Untitled book.md");
  });

  it("creates a missing notes folder and leaves no temp file behind", async () => {
    const notesDir = path.join(await mkdtemp(path.join(tmpdir(), "rigg-learn-vault-")), "Reading", "Books");
    const status = await writeVault(notesDir, book, { highlights, notes });
    expect(status).toEqual({ state: "written", file: path.join(notesDir, "Generative AI Design Patterns - Solutions.md") });
    expect(await readdir(notesDir)).toEqual(["Generative AI Design Patterns - Solutions.md"]);
    expect(await readFile(path.join(notesDir, "Generative AI Design Patterns - Solutions.md"), "utf8")).toBe(
      renderVault(book, { highlights, notes }),
    );
  });

  it("reports a folder it cannot create instead of throwing", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "rigg-learn-vault-"));
    await writeFile(path.join(base, "not-a-folder"), "");
    const status = await writeVault(path.join(base, "not-a-folder", "Notes"), book, { highlights, notes });
    expect(status.state).toBe("failed");
  });
});
