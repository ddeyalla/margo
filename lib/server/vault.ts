import path from "node:path";
import { byChapter, UNTITLED_SECTION } from "@/lib/shared/annotations";
import type { Anchor, Annotations, BookFormat, BookId, Note, VaultStatus } from "@/lib/shared/types";
import { writeFileAtomic } from "./store";

/* The Obsidian mirror: one markdown file per book in NOTES_DIR, rewritten
   from the app's JSON after every highlight or note change. */

export interface VaultBook {
  id: BookId;
  title: string;
  author: string | null;
  format: BookFormat;
}

const GENERATED =
  "Written by rigg learn from the highlights and notes saved in the app. Edits made here are not read back into the app yet.";

/** The book's note file name, without characters that file systems or Obsidian links reject. */
export const vaultFileName = (title: string): string => {
  const name = title
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s*:\s*/g, " - ")
    .replace(/[\\/*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, 120)
    .trim();
  return `${name || "Untitled book"}.md`;
};

/** An Obsidian block id, so [[Book#^h-1a2b3c4d]] links to the passage. */
const blockId = (prefix: "h" | "n", id: string) => `${prefix}-${id.replace(/-/g, "").slice(0, 8).toLowerCase()}`;

interface Entry {
  anchor: Anchor;
  chapterTitle: string | null;
  createdAt: string;
  quote: string;
  blockId: string;
  notes: Note[];
}

const quoteLines = (quote: string, id: string): string[] => {
  const lines = quote
    .trim()
    .split("\n")
    .map((line) => (line.trim() ? `> ${line.trim()}` : ">"));
  lines[lines.length - 1] += ` ^${id}`;
  return lines;
};

/** YAML scalars are written as JSON strings, which YAML reads as double-quoted strings. */
const yaml = (value: string) => JSON.stringify(value);

/**
 * The note file: frontmatter, then one "## Chapter" section per chapter in
 * reading order. Each highlight is a quote ending in its block id, with its
 * notes underneath. A note whose highlight was removed keeps its own quote.
 */
export const renderVault = (book: VaultBook, { highlights, notes }: Annotations): string => {
  const highlightIds = new Set(highlights.map((h) => h.id));
  const attached = new Map<string, Note[]>();
  const standalone: Note[] = [];
  for (const note of [...notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (note.highlightId && highlightIds.has(note.highlightId)) {
      attached.set(note.highlightId, [...(attached.get(note.highlightId) ?? []), note]);
    } else {
      standalone.push(note);
    }
  }
  const entries: Entry[] = [
    ...highlights.map((h) => ({ ...h, blockId: blockId("h", h.id), notes: attached.get(h.id) ?? [] })),
    ...standalone.map((n) => ({ ...n, blockId: blockId("n", n.id), notes: [n] })),
  ];
  const groups = byChapter(entries);

  const tags = new Map<string, string>();
  for (const note of groups.flatMap((group) => group.items.flatMap((entry) => entry.notes))) {
    for (const tag of note.tags) if (!tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag);
  }

  const lines = [
    "---",
    `title: ${yaml(book.title)}`,
    `author: ${yaml(book.author ?? "")}`,
    `format: ${book.format}`,
    `bookId: ${book.id}`,
    ...(tags.size ? ["tags:", ...[...tags.values()].map((tag) => `  - ${yaml(tag)}`)] : ["tags: []"]),
    `generated: ${yaml(GENERATED)}`,
    "---",
  ];
  for (const group of groups) {
    lines.push("", `## ${group.title?.replace(/\s+/g, " ") ?? UNTITLED_SECTION}`);
    for (const entry of group.items) {
      lines.push("", ...quoteLines(entry.quote, entry.blockId));
      for (const note of entry.notes) if (note.body.trim()) lines.push("", note.body.trim());
    }
  }
  return `${lines.join("\n")}\n`;
};

/** Rewrites the book's note file, creating NOTES_DIR if needed. A failure is reported, never thrown. */
export const writeVault = async (notesDir: string, book: VaultBook, annotations: Annotations): Promise<VaultStatus> => {
  const file = path.join(notesDir, vaultFileName(book.title));
  try {
    await writeFileAtomic(file, renderVault(book, annotations));
    return { state: "written", file };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { state: "failed", error: `The markdown copy could not be written to ${notesDir}. ${reason}` };
  }
};
