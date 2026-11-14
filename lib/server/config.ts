import { readFileSync } from "node:fs";
import path from "node:path";

export interface AppConfig {
  booksDir: string;
  notesDir: string | null;
  dataDir: string;
}

export class ConfigError extends Error {}

/** No books folder from the environment or from settings.json. The library page shows its setup screen for this. */
export class BooksFolderMissing extends ConfigError {
  constructor() {
    super("No books folder is set. Choose one, or set BOOKS_DIR in .env.local.");
  }
}

const absolute = (name: string, value: string | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!path.isAbsolute(trimmed)) throw new ConfigError(`${name} must be an absolute path. It is "${trimmed}".`);
  return path.resolve(trimmed);
};

/** A folder saved in settings.json: an absolute path, otherwise null. */
export const savedFolder = (value: unknown): string | null => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed && path.isAbsolute(trimmed) ? path.resolve(trimmed) : null;
};

/** Reads the two folders straight from settings.json. A missing or unreadable file means none are saved. */
const readSavedFolders = (dataDir: string): { booksDir: string | null; notesDir: string | null } => {
  try {
    const raw: unknown = JSON.parse(readFileSync(path.join(/*turbopackIgnore: true*/ dataDir, "settings.json"), "utf8"));
    const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    return { booksDir: savedFolder(value.booksDir), notesDir: savedFolder(value.notesDir) };
  } catch {
    return { booksDir: null, notesDir: null };
  }
};

export interface FolderChoice {
  path: string | null;
  /** The path comes from an environment variable, so the app cannot change it. */
  fromEnv: boolean;
}

/**
 * Where everything lives. The data folder is DATA_DIR or ./data and never depends on settings, because
 * settings.json is inside it. Each other folder is its environment variable first, then settings.json.
 */
export const getFolders = (): { dataDir: string; books: FolderChoice; notes: FolderChoice } => {
  const dataDir = absolute("DATA_DIR", process.env.DATA_DIR) ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
  const envBooks = absolute("BOOKS_DIR", process.env.BOOKS_DIR);
  const envNotes = absolute("NOTES_DIR", process.env.NOTES_DIR);
  const saved = envBooks && envNotes ? { booksDir: null, notesDir: null } : readSavedFolders(dataDir);
  return {
    dataDir,
    books: { path: envBooks ?? saved.booksDir, fromEnv: !!envBooks },
    notes: { path: envNotes ?? saved.notesDir, fromEnv: !!envNotes },
  };
};

/** Reads the folders from the environment and settings.json. A missing books folder is the one hard error. */
export const getConfig = (): AppConfig => {
  const { dataDir, books, notes } = getFolders();
  if (!books.path) throw new BooksFolderMissing();
  return { booksDir: books.path, notesDir: notes.path, dataDir };
};
