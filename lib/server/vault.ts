import path from "node:path";
import { byChapter, sameAnchor, UNTITLED_SECTION } from "@/lib/shared/annotations";
import type { Anchor, Annotations, BookFormat, BookId, CardSet, Cue, LibraryBook, Note, VaultStatus } from "@/lib/shared/types";
import { readBookState, serialized, writeFileAtomic } from "./store";

/* The Obsidian mirror: one markdown file per book in NOTES_DIR, rewritten
   from the app's JSON after every highlight, note or card change. */

export interface VaultBook {
  id: BookId;
  title: string;
  author: string | null;
  format: BookFormat;
}

const GENERATED =
  "Written by rigg learn from the highlights, notes and cards saved in the app. Edits made here are not read back into the app yet.";

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
const blockId = (prefix: "h" | "n" | "c", id: string) => `${prefix}-${id.replace(/-/g, "").slice(0, 8).toLowerCase()}`;

interface Entry {
  anchor: Anchor;
  chapterTitle: string | null;
  createdAt: string;
  quote: string;
  blockId: string;
  notes: Note[];
  cues: Cue[];
}

const quoteLines = (quote: string, id: string): string[] => {
  const lines = quote
    .trim()
    .split("\n")
    .map((line) => (line.trim() ? `> ${line.trim()}` : ">"));
  lines[lines.length - 1] += ` ^${id}`;
  return lines;
};

/** A card as a list item; continuation lines are indented so multi-line answers stay in the item. */
const cueLines = (cue: Cue): string[] => {
  const indent = (text: string) => text.trim().replace(/\n/g, "\n  ");
  return [`- **Q:** ${indent(cue.question)}`, `  **A:** ${indent(cue.answer)}`];
};

/** YAML scalars are written as JSON strings, which YAML reads as double-quoted strings. */
const yaml = (value: string) => JSON.stringify(value);

/**
 * The note file: frontmatter, then one "## Chapter" section per chapter in
 * reading order. Each highlight is a quote ending in its block id, with its
 * notes and cards underneath. A note whose highlight was removed, or cards on
 * a passage with no highlight, keep their own quote.
 */
export const renderVault = (book: VaultBook, { highlights, notes, cardSets = [] }: Annotations & { cardSets?: CardSet[] }): string => {
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
    ...highlights.map((h) => ({ ...h, blockId: blockId("h", h.id), notes: attached.get(h.id) ?? [], cues: [] as Cue[] })),
    ...standalone.map((n) => ({ ...n, blockId: blockId("n", n.id), notes: [n], cues: [] as Cue[] })),
  ];
  for (const set of cardSets) {
    const home = entries.find((entry) => sameAnchor(entry.anchor, set.anchor));
    if (home) home.cues.push(...set.cues);
    else entries.push({ ...set, blockId: blockId("c", set.id), notes: [], cues: set.cues });
  }
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
      if (entry.cues.length) lines.push("", "Cards:", "", ...entry.cues.flatMap(cueLines));
    }
  }
  return `${lines.join("\n")}\n`;
};

/** Rewrites the book's note file, creating NOTES_DIR if needed. A failure is reported, never thrown. */
export const writeVault = async (notesDir: string, book: VaultBook, annotations: Parameters<typeof renderVault>[1]): Promise<VaultStatus> => {
  const file = path.join(notesDir, vaultFileName(book.title));
  try {
    await writeFileAtomic(file, renderVault(book, annotations));
    return { state: "written", file };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { state: "failed", error: `The markdown copy could not be written to ${notesDir}. ${reason}` };
  }
};

/**
 * Rewrites the book's markdown copy from the saved JSON. Writes queue per
 * book and each reads the latest state when its turn comes, so the file
 * always ends up matching the last change.
 */
export const mirrorVault = (book: LibraryBook, dataDir: string, notesDir: string | null): Promise<VaultStatus> =>
  serialized(`vault:${book.id}`, async () => {
    if (!notesDir) return { state: "off" };
    const state = await readBookState(book.id, dataDir);
    const title = state.meta?.title ?? book.fileTitle;
    const author = state.meta?.author ?? book.fileAuthor;
    return writeVault(notesDir, { id: book.id, title, author, format: book.format }, state);
  });
