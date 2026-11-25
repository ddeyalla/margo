import { createHash } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { serialized, writeFileAtomic } from "./store";

/* Files the app keeps in the notes folder (an Obsidian vault) beside the reader's own: markdown notes now, and
   whiteboards later. Everything here is about one rule: a file the reader or another app changed is never
   overwritten. Paths are relative to the notes folder and "/"-separated, as Obsidian writes them. */

/** A path the app will not touch: outside the notes folder, hidden, through a link, or of a kind it doesn't edit. */
export class NotesPathError extends Error {
  override name = "NotesPathError";
}

/** The exact bytes of a version of a file, so a save can tell whether the file changed since it was read. */
export const contentHash = (content: string | Uint8Array): string => createHash("sha256").update(content).digest("hex");

const inside = (root: string, file: string) => file === root || file.startsWith(root + path.sep);

/**
 * The absolute file for `rel`, refusing anything the app must not read or write: an absolute path, "..",
 * a hidden file or folder (".obsidian", ".trash"), an extension not in `extensions`, or a path that leaves
 * the notes folder through a symbolic link.
 */
export const resolveInside = async (notesDir: string, rel: unknown, extensions: readonly string[]): Promise<{ file: string; rel: string }> => {
  if (typeof rel !== "string" || !rel || rel.length > 1024 || /[\u0000-\u001f]/.test(rel)) throw new NotesPathError("Invalid path.");
  const parts = rel.normalize("NFC").split(/[\\/]/);
  if (path.isAbsolute(rel) || parts.some((part) => !part || part === "." || part === ".." || part.startsWith("."))) {
    throw new NotesPathError("That path is outside the notes folder.");
  }
  const ext = path.extname(rel).toLowerCase();
  if (!extensions.includes(ext)) throw new NotesPathError(`Only ${extensions.join(", ")} files can be opened here.`);
  const root = await realpath(notesDir);
  const file = path.join(/*turbopackIgnore: true*/ root, ...parts);
  /* Every part that exists must be a real folder or file, not a link out of the notes folder. */
  let at = root;
  for (const part of parts) {
    at = path.join(/*turbopackIgnore: true*/ at, part);
    const info = await lstat(at).catch(() => null);
    if (!info) break;
    if (info.isSymbolicLink()) throw new NotesPathError("That path goes through a link the app does not follow.");
  }
  if (!inside(root, file)) throw new NotesPathError("That path is outside the notes folder.");
  return { file, rel: parts.join("/") };
};

export interface Versioned {
  text: string;
  hash: string;
}

/** A file's text and the hash of its bytes, or null when it does not exist. */
export const readVersioned = async (file: string): Promise<Versioned | null> => {
  try {
    const bytes = await readFile(file);
    return { text: bytes.toString("utf8"), hash: contentHash(bytes) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

export interface FolderFile {
  rel: string;
  file: string;
  mtimeMs: number;
  size: number;
}

/** Caps how much of a huge vault is listed, so one folder of exports can't stall the app. */
const MAX_FILES = 20_000;

/** Every file with one of `extensions` under the notes folder, skipping hidden entries and symbolic links. Missing folder: none. */
export const listFolderFiles = async (notesDir: string, extensions: readonly string[]): Promise<FolderFile[]> => {
  const found: FolderFile[] = [];
  const walk = async (dir: string, rel: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (found.length >= MAX_FILES || entry.name.startsWith(".")) continue;
      const file = path.join(/*turbopackIgnore: true*/ dir, entry.name);
      const childRel = rel ? `${rel}/${entry.name.normalize("NFC")}` : entry.name.normalize("NFC");
      if (entry.isDirectory()) await walk(file, childRel);
      else if (entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase())) {
        const info = await lstat(file).catch(() => null);
        if (info) found.push({ rel: childRel, file, mtimeMs: info.mtimeMs, size: info.size });
      }
    }
  };
  await walk(notesDir, "");
  return found;
};

/** Writes `content` to a new file named `name` in `dir`, or "name 1", "name 2"… when taken. Never replaces a file. Returns the file used. */
export const createUnique = async (dir: string, name: string, ext: string, content: string | Uint8Array): Promise<string> => {
  await mkdir(dir, { recursive: true });
  for (let n = 0; n < 1000; n++) {
    const file = path.join(/*turbopackIgnore: true*/ dir, `${name}${n ? ` ${n}` : ""}${ext}`);
    let handle;
    try {
      handle = await open(file, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    try {
      await handle.writeFile(content);
    } finally {
      await handle.close();
    }
    return file;
  }
  throw new Error(`Every name like "${name}" is taken.`);
};

const pad = (n: number) => String(n).padStart(2, "0");

/** "Note (conflict 2026-11-24 14.32)", the name the reader's version takes when the file changed under it. */
export const conflictName = (base: string, at: Date): string =>
  `${base} (conflict ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}.${pad(at.getMinutes())})`;

export type SaveResult =
  | { state: "saved"; hash: string }
  /** The file changed or went away since it was read. It was left as it is, and the text was written to `copy`. */
  | { state: "conflict"; copy: string; copyHash: string; current: Versioned | null };

/**
 * Saves `text` to `file` only if the file is still the version read as `baseHash`, or already holds `text`. When
 * it changed or was deleted since, the file is left alone and the text goes to a conflict copy beside it, so both are kept.
 * Saves to one file queue behind each other.
 */
export const saveIfUnchanged = (file: string, text: string, baseHash: string, at = new Date()): Promise<SaveResult> =>
  serialized(file, async () => {
    const current = await readVersioned(file);
    /* Already this text, whatever version the save started from: a repeated save, such as one more as the page closes. */
    if (current?.text === text) return { state: "saved", hash: current.hash };
    if (current?.hash === baseHash) {
      await writeFileAtomic(file, text);
      return { state: "saved", hash: contentHash(text) };
    }
    const ext = path.extname(file);
    const copy = await createUnique(path.dirname(file), conflictName(path.basename(file, ext), at), ext, text);
    return { state: "conflict", copy, copyHash: contentHash(text), current };
  });
