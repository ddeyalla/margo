import path from "node:path";

export interface AppConfig {
  booksDir: string;
  notesDir: string | null;
  dataDir: string;
}

export class ConfigError extends Error {}

const absolute = (name: string, value: string | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!path.isAbsolute(trimmed)) throw new ConfigError(`${name} must be an absolute path. It is "${trimmed}".`);
  return path.resolve(trimmed);
};

/** Reads the folders from .env.local. A missing BOOKS_DIR is the one hard error. */
export const getConfig = (): AppConfig => {
  const booksDir = absolute("BOOKS_DIR", process.env.BOOKS_DIR);
  if (!booksDir) throw new ConfigError("Set BOOKS_DIR in .env.local to the folder that holds your books.");
  return {
    booksDir,
    notesDir: absolute("NOTES_DIR", process.env.NOTES_DIR),
    dataDir: path.join(process.cwd(), "data"),
  };
};
