import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { Backlink, BookFileInfo, Embed, HighlightBlock, NoteFileInfo, NoteSave, NotesIndex, OpenedNote } from "@/lib/shared/notes";
import { parseTags } from "@/lib/shared/tags";
import { findBlock, noteTitle, parseWikiLinks, resolveWikiLink, withoutCode } from "@/lib/shared/wikilinks";
import { createUnique, listFolderFiles, NotesPathError, readVersioned, resolveInside, saveIfUnchanged } from "./notes-folder";
import { fileBookId } from "./vault";

/* Standalone notes: the reader's own .md files anywhere in the notes folder, edited in place. The per-book files
   the app writes from its highlights are listed apart and never edited here; their highlights can be embedded. */

const MARKDOWN = [".md"];
export const IMAGES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const IMAGE_EXTENSIONS = Object.keys(IMAGES);

interface Scanned {
  notes: (NoteFileInfo & { file: string })[];
  books: (BookFileInfo & { file: string })[];
}

/** Every markdown file in the notes folder, split into the reader's notes and the app's per-book files. */
const scan = async (notesDir: string): Promise<Scanned> => {
  const files = await listFolderFiles(notesDir, MARKDOWN);
  const scanned: Scanned = { notes: [], books: [] };
  for (const { rel, file, mtimeMs } of files) {
    const bookId = await fileBookId(file);
    if (bookId) scanned.books.push({ path: rel, title: noteTitle(rel), bookId, file });
    else scanned.notes.push({ path: rel, title: noteTitle(rel), modifiedAt: new Date(mtimeMs).toISOString(), file });
  }
  scanned.notes.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.path.localeCompare(b.path));
  return scanned;
};

const readText = (file: string) => readFile(file, "utf8").catch(() => "");

export const listNotes = async (notesDir: string): Promise<NotesIndex> => {
  const { notes, books } = await scan(notesDir);
  const tags = new Map<string, string>();
  for (const note of notes) {
    for (const tag of parseTags(await readText(note.file))) if (!tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag);
  }
  const strip = <T extends { file: string }>({ file, ...rest }: T) => (void file, rest);
  return { notes: notes.map(strip), books: books.map(strip), tags: [...tags.values()].sort((a, b) => a.localeCompare(b)) };
};

/** Why a note can't be edited: it is one of the app's per-book files. */
export class GeneratedFileError extends NotesPathError {
  constructor() {
    super("This file is written by rigg learn from a book's highlights. Edit those in the book instead.");
  }
}

/** The reader's note at `rel`, refusing paths outside the notes folder and the app's per-book files. */
const noteFile = async (notesDir: string, rel: unknown) => {
  const resolved = await resolveInside(notesDir, rel, MARKDOWN);
  if (await fileBookId(resolved.file)) throw new GeneratedFileError();
  return resolved;
};

/** Every note that links to `rel`, with the line each link is on. */
export const backlinks = async (notesDir: string, rel: string): Promise<Backlink[]> => {
  const { notes, books } = await scan(notesDir);
  const paths = [...notes, ...books].map((n) => n.path);
  const found: Backlink[] = [];
  for (const note of notes) {
    if (note.path === rel) continue;
    const text = await readText(note.file);
    const link = parseWikiLinks(text).find((l) => resolveWikiLink(l.target, note.path, paths) === rel);
    if (!link) continue;
    const start = text.lastIndexOf("\n", link.from) + 1;
    const end = text.indexOf("\n", link.to);
    found.push({ path: note.path, title: note.title, context: text.slice(start, end === -1 ? undefined : end).trim().slice(0, 240) });
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
};

/** A note's text and version, or null when it does not exist. */
export const openNote = async (notesDir: string, rel: unknown): Promise<OpenedNote | null> => {
  const { file, rel: clean } = await noteFile(notesDir, rel);
  const read = await readVersioned(file);
  return read ? { path: clean, ...read, backlinks: await backlinks(notesDir, clean) } : null;
};

/** The note's current version only, for noticing a change made in another app. */
export const noteHash = async (notesDir: string, rel: unknown): Promise<string | null> => {
  const { file } = await noteFile(notesDir, rel);
  return (await readVersioned(file))?.hash ?? null;
};

const relOf = async (notesDir: string, file: string) => path.relative(await realpath(notesDir), file).split(path.sep).join("/");

/** Saves a note if it is still the version opened as `baseHash`; otherwise keeps both, as `saveIfUnchanged` says. */
export const saveNote = async (notesDir: string, rel: unknown, text: string, baseHash: string): Promise<NoteSave> => {
  const { file } = await noteFile(notesDir, rel);
  const result = await saveIfUnchanged(file, text, baseHash);
  return result.state === "saved" ? result : { ...result, copy: await relOf(notesDir, result.copy) };
};

const cleanName = (name: string) =>
  name
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, 120)
    .trim();

/** Creates a new note in `folder` (relative, "" for the root) named `name`, or "name 1"… when taken. Never replaces a file. */
export const createNote = async (notesDir: string, name: unknown, folder: unknown = "", text = ""): Promise<string> => {
  const title = cleanName(typeof name === "string" ? name : "") || "Untitled";
  const where = typeof folder === "string" && folder ? folder.replace(/\/+$/, "") : "";
  /* Checks the folder the same way a note's path is checked. */
  const { file } = await resolveInside(notesDir, where ? `${where}/${title}.md` : `${title}.md`, MARKDOWN);
  return relOf(notesDir, await createUnique(path.dirname(file), title, ".md", text));
};

/** The text a link or embed points into: a block for "^id", the section under a heading, or the whole note. */
const pick = (text: string, subpath: string | null): string | null => {
  if (!subpath) return text;
  if (subpath.startsWith("^")) return findBlock(text, subpath.slice(1));
  const lines = text.split(/\r?\n/);
  const wanted = subpath.trim().toLowerCase();
  const start = lines.findIndex((line) => /^#{1,6}\s/.test(line) && line.replace(/^#+\s*/, "").trim().toLowerCase() === wanted);
  if (start === -1) return null;
  const level = (lines[start].match(/^#+/) ?? [""])[0].length;
  const end = lines.findIndex((line, i) => i > start && new RegExp(`^#{1,${level}}\\s`).test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n").trim();
};

/** What `![[target#subpath]]` shows, linked from the note at `from`. */
export const readEmbed = async (notesDir: string, target: string, subpath: string | null, from: string): Promise<Embed | null> => {
  const { notes, books } = await scan(notesDir);
  const all = [...notes, ...books];
  const rel = resolveWikiLink(target, from, all.map((n) => n.path));
  const hit = all.find((n) => n.path === rel);
  if (!hit) return null;
  const text = pick(await readText(hit.file), subpath);
  if (text === null) return null;
  return { path: hit.path, text: text.slice(0, 20_000), bookId: "bookId" in hit ? hit.bookId : null };
};

/** Every highlight in the per-book files, newest book file first, for embedding by block id. */
export const listHighlightBlocks = async (notesDir: string): Promise<HighlightBlock[]> => {
  const { notes, books } = await scan(notesDir);
  const paths = [...notes, ...books].map((n) => n.path);
  const blocks: HighlightBlock[] = [];
  for (const book of books) {
    const text = await readText(book.file);
    const target = paths.filter((p) => noteTitle(p).toLowerCase() === book.title.toLowerCase()).length > 1 ? book.path.replace(/\.md$/, "") : book.title;
    for (const [, id] of withoutCode(text).matchAll(/ \^(h-[0-9a-f]{8})\s*$/gm)) {
      const quote = findBlock(text, id);
      if (quote) blocks.push({ target: `${target}#^${id}`, bookTitle: book.title, quote: quote.slice(0, 400) });
    }
  }
  return blocks;
};

/* ----- Images: pasted into a note, saved where the vault's own settings put attachments. ----- */

interface VaultLinkSettings {
  attachmentFolderPath: string | null;
  useMarkdownLinks: boolean;
}

/** The attachment settings in the vault's .obsidian/app.json, when it has them. */
const vaultLinkSettings = async (notesDir: string): Promise<VaultLinkSettings> => {
  try {
    const raw: unknown = JSON.parse(await readFile(path.join(/*turbopackIgnore: true*/ notesDir, ".obsidian", "app.json"), "utf8"));
    const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    return {
      attachmentFolderPath: typeof value.attachmentFolderPath === "string" ? value.attachmentFolderPath : null,
      useMarkdownLinks: value.useMarkdownLinks === true,
    };
  } catch {
    return { attachmentFolderPath: null, useMarkdownLinks: false };
  }
};

/**
 * The folder, relative to the notes folder, that a note at `from` saves pasted images to, read as Obsidian
 * reads attachmentFolderPath: "/" is the root, "./" the note's own folder, "./x" a folder under it, anything
 * else a folder from the root. Unset: "attachments".
 */
export const attachmentFolder = (setting: string | null, from: string): string => {
  const noteDir = from.split("/").slice(0, -1).join("/");
  const clean = (p: string) => p.split("/").filter((part) => part && part !== ".").join("/");
  if (setting === null) return "attachments";
  if (setting === "/" || setting === "") return "";
  if (setting === "./" || setting === ".") return noteDir;
  if (setting.startsWith("./")) return clean([noteDir, setting.slice(2)].join("/"));
  return clean(setting);
};

const stamp = (at: Date) =>
  `${at.getFullYear()}${[at.getMonth() + 1, at.getDate(), at.getHours(), at.getMinutes(), at.getSeconds()].map((n) => String(n).padStart(2, "0")).join("")}`;

export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/** Saves a pasted image and answers with the link to put in the note. */
export const saveImage = async (notesDir: string, from: unknown, mediaType: string, bytes: Uint8Array, at = new Date()): Promise<{ path: string; link: string }> => {
  const ext = Object.entries(IMAGES).find(([, type]) => type === mediaType)?.[0];
  if (!ext) throw new NotesPathError("Only PNG, JPEG, GIF and WebP images can be pasted.");
  const { rel: note } = await resolveInside(notesDir, from, MARKDOWN);
  const settings = await vaultLinkSettings(notesDir);
  const folder = attachmentFolder(settings.attachmentFolderPath, note);
  const name = `Pasted image ${stamp(at)}`;
  const { file } = await resolveInside(notesDir, folder ? `${folder}/${name}${ext}` : `${name}${ext}`, IMAGE_EXTENSIONS);
  const rel = await relOf(notesDir, await createUnique(path.dirname(file), name, ext, bytes));
  const fileName = rel.split("/").pop()!;
  const link = settings.useMarkdownLinks ? `![](${encodeURI(rel)})` : `![[${fileName}]]`;
  return { path: rel, link };
};

/** An image in the notes folder by its link target from the note at `from`, or by its path. */
export const readImage = async (notesDir: string, target: string, from: string): Promise<{ bytes: Buffer; mediaType: string } | null> => {
  const images = await listFolderFiles(notesDir, IMAGE_EXTENSIONS);
  let name: string;
  try {
    name = decodeURI(target);
  } catch {
    return null;
  }
  const rel = resolveWikiLink(name, from, images.map((i) => i.rel));
  if (!rel) return null;
  const { file } = await resolveInside(notesDir, rel, IMAGE_EXTENSIONS);
  const bytes = await readFile(file).catch(() => null);
  return bytes ? { bytes, mediaType: IMAGES[path.extname(file).toLowerCase()] } : null;
};
