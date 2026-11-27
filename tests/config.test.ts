import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BooksFolderMissing, ConfigError, getConfig, getFolders } from "@/lib/server/config";

describe("getConfig", () => {
  let dir: string;
  const saveSettings = (value: unknown) => writeFile(path.join(dir, "data", "settings.json"), JSON.stringify(value));

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "margo-config-"));
    await mkdir(path.join(dir, "data"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    vi.stubEnv("BOOKS_DIR", "");
    vi.stubEnv("NOTES_DIR", "");
    vi.stubEnv("DATA_DIR", "");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("keeps the data folder in ./data unless DATA_DIR is set", () => {
    vi.stubEnv("BOOKS_DIR", "/books");
    expect(getConfig().dataDir).toBe(path.join(dir, "data"));
    vi.stubEnv("DATA_DIR", "/elsewhere/data");
    expect(getConfig().dataDir).toBe("/elsewhere/data");
  });

  it("refuses a relative DATA_DIR", () => {
    vi.stubEnv("DATA_DIR", "data");
    expect(() => getConfig()).toThrow(ConfigError);
  });

  it("reads the folders from settings.json when no variable is set", async () => {
    await saveSettings({ booksDir: "/saved/books", notesDir: "/saved/notes" });
    expect(getConfig()).toEqual({ booksDir: "/saved/books", notesDir: "/saved/notes", dataDir: path.join(dir, "data") });
  });

  it("lets the environment win over settings.json, one folder at a time", async () => {
    await saveSettings({ booksDir: "/saved/books", notesDir: "/saved/notes" });
    vi.stubEnv("BOOKS_DIR", "/env/books");
    expect(getConfig()).toMatchObject({ booksDir: "/env/books", notesDir: "/saved/notes" });
    expect(getFolders().books).toEqual({ path: "/env/books", fromEnv: true });
    expect(getFolders().notes).toEqual({ path: "/saved/notes", fromEnv: false });
  });

  it("reads settings.json from DATA_DIR", async () => {
    const other = path.join(dir, "other");
    await mkdir(other);
    await writeFile(path.join(other, "settings.json"), JSON.stringify({ booksDir: "/in/other" }));
    vi.stubEnv("DATA_DIR", other);
    expect(getConfig()).toMatchObject({ booksDir: "/in/other", dataDir: other });
  });

  it("throws BooksFolderMissing when neither source has a books folder", async () => {
    expect(() => getConfig()).toThrow(BooksFolderMissing);
    await saveSettings({ booksDir: "relative/path" });
    expect(() => getConfig()).toThrow(BooksFolderMissing);
  });

  it("ignores an unreadable settings.json", async () => {
    await writeFile(path.join(dir, "data", "settings.json"), "{not json");
    expect(() => getConfig()).toThrow(BooksFolderMissing);
  });
});
