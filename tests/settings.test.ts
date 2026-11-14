import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/settings/route";
import { readSettings, saveSettings } from "@/lib/server/settings";

describe("settings", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-settings-"));
    await mkdir(path.join(dir, "data"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    vi.stubEnv("BOOKS_DIR", dir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("starts with the chapters closed and the chat tab", async () => {
    expect(await readSettings()).toMatchObject({ chaptersOpen: false, panelTab: "chat" });
  });

  it("keeps the chapters column and the side panel tab", async () => {
    await saveSettings({ chaptersOpen: true });
    await saveSettings({ panelTab: "highlights" });
    expect(await readSettings()).toMatchObject({ chaptersOpen: true, panelTab: "highlights" });
  });

  it("falls back for values it doesn't know", async () => {
    await writeFile(path.join(dir, "data", "settings.json"), JSON.stringify({ chaptersOpen: "yes", panelTab: "quiz" }));
    expect(await readSettings()).toMatchObject({ chaptersOpen: false, panelTab: "chat" });
  });
});

describe("folder settings", () => {
  let dir: string;
  let books: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-folders-"));
    books = path.join(dir, "books");
    await mkdir(path.join(dir, "data"));
    await mkdir(books);
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    vi.stubEnv("BOOKS_DIR", "");
    vi.stubEnv("NOTES_DIR", "");
    vi.stubEnv("DATA_DIR", "");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const patch = (body: unknown) =>
    PATCH(new Request("http://localhost/api/settings", { method: "PATCH", body: JSON.stringify(body) }));

  it("reads settings with no books folder set", async () => {
    expect(await readSettings()).toMatchObject({ booksDir: null, notesDir: null });
  });

  it("keeps only absolute folders when reading", async () => {
    await writeFile(path.join(dir, "data", "settings.json"), JSON.stringify({ booksDir: books, notesDir: "relative", other: 1 }));
    expect(await readSettings()).toMatchObject({ booksDir: books, notesDir: null });
    await writeFile(path.join(dir, "data", "settings.json"), JSON.stringify({ booksDir: 4, notesDir: "  " }));
    expect(await readSettings()).toMatchObject({ booksDir: null, notesDir: null });
  });

  it("saves both folders and clears the notes folder with null", async () => {
    const notes = path.join(dir, "notes");
    await mkdir(notes);
    expect((await patch({ booksDir: books, notesDir: notes })).status).toBe(200);
    expect(await readSettings()).toMatchObject({ booksDir: books, notesDir: notes });
    expect((await patch({ notesDir: null })).status).toBe(200);
    expect(await readSettings()).toMatchObject({ booksDir: books, notesDir: null });
  });

  it("rejects a folder that is relative, missing, a file or the wrong type, and saves nothing", async () => {
    const file = path.join(dir, "file.txt");
    await writeFile(file, "x");
    for (const body of [
      { booksDir: "books" },
      { booksDir: path.join(dir, "missing") },
      { booksDir: file },
      { booksDir: null },
      { booksDir: 4 },
      { notesDir: "" },
      { notesDir: file },
    ]) {
      const response = await patch(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(((await response.json()) as { error: string }).error).toMatch(/absolute path to a folder that exists/);
    }
    expect(await readSettings()).toMatchObject({ booksDir: null, notesDir: null });
  });
});
