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

  it("shows the library as a shelf until the grid is chosen, and ignores views it doesn't know", async () => {
    expect(await readSettings()).toMatchObject({ libraryView: "shelf" });
    await saveSettings({ libraryView: "grid" });
    expect(await readSettings()).toMatchObject({ libraryView: "grid" });
    await writeFile(path.join(dir, "data", "settings.json"), JSON.stringify({ libraryView: "carousel" }));
    expect(await readSettings()).toMatchObject({ libraryView: "shelf" });
  });

  it("starts both page colours on auto, following the app's theme", async () => {
    expect(await readSettings()).toMatchObject({ epubPage: "auto", pdfPage: "auto" });
  });

  it("turns the old dark pages into auto and keeps a light page the reader picked", async () => {
    const old = (value: object) => writeFile(path.join(dir, "data", "settings.json"), JSON.stringify(value));
    await old({ epubTheme: "dark", pdfDarkPages: true });
    expect(await readSettings()).toMatchObject({ epubPage: "auto", pdfPage: "auto" });
    await old({ epubTheme: "light", pdfDarkPages: false });
    expect(await readSettings()).toMatchObject({ epubPage: "light", pdfPage: "light" });
  });

  it("remembers the read-along voice and speed, and drops speeds it doesn't offer", async () => {
    expect(await readSettings()).toMatchObject({ readAloudVoice: null, readAloudRate: 1 });
    await saveSettings({ readAloudVoice: "com.apple.voice.compact.en-US.Samantha", readAloudRate: 1.5 });
    expect(await readSettings()).toMatchObject({ readAloudVoice: "com.apple.voice.compact.en-US.Samantha", readAloudRate: 1.5 });
    await writeFile(path.join(dir, "data", "settings.json"), JSON.stringify({ readAloudVoice: 4, readAloudRate: 3 }));
    expect(await readSettings()).toMatchObject({ readAloudVoice: null, readAloudRate: 1 });
  });

  it("saves the read-along voice and speed through the route", async () => {
    const patch = (body: object) => PATCH(new Request("http://x/api/settings", { method: "PATCH", body: JSON.stringify(body) }));
    expect((await patch({ readAloudRate: 1.25, readAloudVoice: "Daniel" })).status).toBe(200);
    expect(await readSettings()).toMatchObject({ readAloudVoice: "Daniel", readAloudRate: 1.25 });
    expect((await patch({ readAloudVoice: null })).status).toBe(200);
    expect(await readSettings()).toMatchObject({ readAloudVoice: null, readAloudRate: 1.25 });
    expect((await patch({ readAloudRate: 5 })).status).toBe(400);
  });

  it("keeps a page colour chosen after the move to auto", async () => {
    await saveSettings({ epubPage: "dark", pdfPage: "dark" });
    expect(await readSettings()).toMatchObject({ epubPage: "dark", pdfPage: "dark" });
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

  it("saves a tutor's model, keeps the others, and goes back to the default with null", async () => {
    expect((await patch({ models: { claude: "claude-sonnet-5-5" } })).status).toBe(200);
    expect((await patch({ models: { api: "claude-opus-5-5" } })).status).toBe(200);
    expect((await readSettings()).models).toEqual({ claude: "claude-sonnet-5-5", api: "claude-opus-5-5" });
    expect((await patch({ models: { claude: null } })).status).toBe(200);
    expect((await readSettings()).models).toEqual({ api: "claude-opus-5-5" });
  });

  it("refuses a model the tutor doesn't offer, and saves nothing", async () => {
    for (const models of [{ claude: "gpt-6-luna" }, { codex: "gpt-6-luna" }, { nobody: "claude-opus-5-5" }, { api: 4 }]) {
      expect((await patch({ models })).status).toBe(400);
    }
    expect((await readSettings()).models).toEqual({});
  });

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
