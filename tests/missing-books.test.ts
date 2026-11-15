import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "@/app/api/library/missing/[id]/route";
import { GET, POST } from "@/app/api/library/missing/route";
import { bookIdOf, findBook, scanLibrary } from "@/lib/server/library";
import { readIndex } from "@/lib/server/library-index";
import { forget, listMissing, MissingBookError, rebind } from "@/lib/server/missing-books";
import { rankCandidates, type RelinkCandidate } from "@/lib/shared/relink";
import type { BookId } from "@/lib/shared/types";

/* Outside a request there is no render to mark dynamic. */
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => undefined }));

let root: string;
let dataDir: string;
let notesDir: string;

const write = async (dir: string, relPath: string, content: string) => {
  const file = path.join(dir, relPath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
};

const exists = (file: string) =>
  readFile(file).then(
    () => true,
    () => false,
  );

const stateOf = (id: string, highlights = 1) =>
  JSON.stringify({
    meta: { title: `Title of ${id.slice(0, 4)}`, author: null, format: "pdf", relPath: "old/place.pdf" },
    highlights: Array.from({ length: highlights }, (_, i) => ({ id: `h${i}` })),
    notes: [],
    cardSets: [],
    threads: [{ id: "t1", kind: "general", messages: [] }],
  });

/** A book whose file is replaced by different bytes at a new path, so no matcher can find it again. */
const loseBook = async (relPath: string, newPath: string, content: string) => {
  await rm(path.join(root, relPath));
  await write(root, newPath, content);
};

const unknownId = "0123456789abcdef0123456789abcdef01234567" as BookId;

beforeEach(async () => {
  const base = await mkdtemp(path.join(tmpdir(), "rigg-learn-missing-"));
  root = path.join(base, "books");
  dataDir = path.join(base, "data");
  notesDir = path.join(base, "notes");
  await Promise.all([mkdir(root), mkdir(dataDir), mkdir(notesDir)]);
  vi.stubEnv("BOOKS_DIR", root);
  vi.stubEnv("DATA_DIR", dataDir);
  vi.stubEnv("NOTES_DIR", notesDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Two books seeded at known ids; the first has saved data. */
const seedTwo = async () => {
  await write(root, "a/first.pdf", "first book bytes");
  await write(root, "b/second.epub", "second book bytes, longer");
  await scanLibrary(root, dataDir);
  const first = bookIdOf("a/first.pdf");
  const second = bookIdOf("b/second.epub");
  await writeFile(path.join(dataDir, `${first}.json`), stateOf(first, 2));
  return { first, second };
};

describe("listMissing", () => {
  it("lists a lost book with saved data and a state file with no index entry, and nothing that is present", async () => {
    const { first, second } = await seedTwo();
    await writeFile(path.join(dataDir, `${second}.position.json`), JSON.stringify({ position: null, lastReadAt: null }));
    await loseBook("a/first.pdf", "c/renamed.pdf", "edited first book bytes");
    const stray = "fedcba9876543210fedcba9876543210fedcba98";
    await writeFile(path.join(dataDir, `${stray}.json`), stateOf(stray, 0));

    const missing = await listMissing(root, dataDir);
    expect(missing.map((book) => book.id).sort()).toEqual([first, stray].sort());
    const lost = missing.find((book) => book.id === first);
    expect(lost).toMatchObject({
      title: `Title of ${first.slice(0, 4)}`,
      format: "pdf",
      relPath: "a/first.pdf",
      sizeBytes: "first book bytes".length,
      saved: { highlights: 2, notes: 0, cardSets: 0, threads: 1, hasPosition: false },
    });
    expect(lost?.missingSince).toEqual(expect.any(Number));
    expect(missing.find((book) => book.id === stray)).toMatchObject({ relPath: "old/place.pdf", missingSince: null, sizeBytes: null });
  });

  it("names a book with no title from its last path, and leaves out a lost book with nothing saved", async () => {
    await write(root, "a/first.pdf", "first book bytes");
    await write(root, "b/second.pdf", "second book bytes");
    await scanLibrary(root, dataDir);
    const first = bookIdOf("a/first.pdf");
    await writeFile(path.join(dataDir, `${first}.position.json`), JSON.stringify({ position: null, lastReadAt: null }));
    await rm(path.join(root, "a/first.pdf"));
    await rm(path.join(root, "b/second.pdf"));
    await write(root, "c/third.pdf", "a different book");

    const missing = await listMissing(root, dataDir);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ id: first, title: "first.pdf", format: "pdf" });
  });

  it("lists nothing when the books folder is empty, because that proves no book is gone", async () => {
    const { first } = await seedTwo();
    await rm(path.join(root, "a"), { recursive: true });
    await rm(path.join(root, "b"), { recursive: true });
    expect(await listMissing(root, dataDir)).toEqual([]);
    await expect(forget(first, root, dataDir)).rejects.toMatchObject({ problem: "not_missing" });
  });
});

describe("rebind", () => {
  it("gives the missing book's id to the chosen file and drops the file's own id", async () => {
    const { first } = await seedTwo();
    await loseBook("a/first.pdf", "c/renamed.pdf", "edited first book bytes");
    const books = await scanLibrary(root, dataDir);
    const target = books.find((book) => book.relPath === "c/renamed.pdf")!.id;
    await mkdir(path.join(dataDir, "covers"), { recursive: true });
    await writeFile(path.join(dataDir, "covers", `${target}.jpg`), "cover");
    await writeFile(path.join(dataDir, "covers", `${first}.none`), "");

    await rebind(first, target, root, dataDir);

    expect((await findBook(first, root, dataDir))?.book.relPath).toBe("c/renamed.pdf");
    expect(await findBook(target, root, dataDir)).toBeNull();
    const index = (await readIndex(path.join(dataDir, "library.json")))!;
    expect(index[target]).toBeUndefined();
    expect(index[first]).toMatchObject({ relPath: "c/renamed.pdf", missingSince: null });
    expect(await exists(path.join(dataDir, "covers", `${target}.jpg`))).toBe(false);
    expect(await exists(path.join(dataDir, "covers", `${first}.none`))).toBe(false);
    expect(await listMissing(root, dataDir)).toEqual([]);
    /* The next scan keeps the binding. */
    expect((await scanLibrary(root, dataDir)).find((book) => book.relPath === "c/renamed.pdf")?.id).toBe(first);
  });

  it("refuses a file that has saved data of its own, a book that is not missing, and a file that is not there", async () => {
    const { first, second } = await seedTwo();
    await writeFile(path.join(dataDir, `${second}.json`), stateOf(second));
    await expect(rebind(first, second, root, dataDir)).rejects.toMatchObject({ problem: "not_missing" });

    await loseBook("a/first.pdf", "c/renamed.pdf", "edited first book bytes");
    await expect(rebind(first, second, root, dataDir)).rejects.toMatchObject({ problem: "target_has_data" });
    await expect(rebind(first, unknownId, root, dataDir)).rejects.toMatchObject({ problem: "target_not_found" });
    await expect(rebind(first, first, root, dataDir)).rejects.toBeInstanceOf(MissingBookError);
    expect((await findBook(second, root, dataDir))?.book.relPath).toBe("b/second.epub");
  });
});

describe("forget", () => {
  it("deletes exactly the missing book's files and its index entry", async () => {
    const { first, second } = await seedTwo();
    await writeFile(path.join(dataDir, `${first}.position.json`), JSON.stringify({ position: null, lastReadAt: null }));
    await writeFile(path.join(dataDir, `${second}.json`), stateOf(second));
    await mkdir(path.join(dataDir, "covers"), { recursive: true });
    await mkdir(path.join(dataDir, "attachments", first), { recursive: true });
    await mkdir(path.join(dataDir, "attachments", second), { recursive: true });
    for (const id of [first, second]) {
      await writeFile(path.join(dataDir, "covers", `${id}.jpg`), "cover");
      await writeFile(path.join(dataDir, "attachments", id, "0123456789abcdef0123456789abcdef.png"), "image");
    }
    await write(notesDir, "First book.md", `---\nbookId: ${first}\n---\n`);
    await loseBook("a/first.pdf", "c/renamed.pdf", "edited first book bytes");

    await forget(first, root, dataDir);

    expect(await exists(path.join(dataDir, `${first}.json`))).toBe(false);
    expect(await exists(path.join(dataDir, `${first}.position.json`))).toBe(false);
    expect(await exists(path.join(dataDir, "covers", `${first}.jpg`))).toBe(false);
    expect(await readdir(path.join(dataDir, "attachments"))).toEqual([second]);
    expect((await readIndex(path.join(dataDir, "library.json")))![first]).toBeUndefined();
    expect(await exists(path.join(dataDir, `${second}.json`))).toBe(true);
    expect(await exists(path.join(dataDir, "covers", `${second}.jpg`))).toBe(true);
    expect(await readFile(path.join(notesDir, "First book.md"), "utf8")).toContain(first);
    expect(await listMissing(root, dataDir)).toEqual([]);
  });

  it("refuses a book whose file is present", async () => {
    const { first } = await seedTwo();
    await expect(forget(first, root, dataDir)).rejects.toMatchObject({ problem: "not_missing" });
    expect(await exists(path.join(dataDir, `${first}.json`))).toBe(true);
  });
});

describe("missing-books routes", () => {
  const post = (body: unknown) =>
    POST(new Request("http://127.0.0.1/api/library/missing", { method: "POST", body: JSON.stringify(body) }));
  const del = (id: string) =>
    DELETE(new Request(`http://127.0.0.1/api/library/missing/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });

  it("lists, relinks and forgets with the right status codes", async () => {
    const { first, second } = await seedTwo();
    await loseBook("a/first.pdf", "c/renamed.pdf", "edited first book bytes");
    const listed = await GET();
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { books: { id: string }[] }).books.map((book) => book.id)).toEqual([first]);

    expect((await post({ id: first })).status).toBe(400);
    expect((await post({ id: "nope", targetId: second })).status).toBe(400);
    expect((await post({ id: unknownId, targetId: second })).status).toBe(404);
    expect((await post({ id: first, targetId: unknownId })).status).toBe(404);
    await writeFile(path.join(dataDir, `${second}.json`), stateOf(second));
    expect((await post({ id: first, targetId: second })).status).toBe(409);

    const target = (await scanLibrary(root, dataDir)).find((book) => book.relPath === "c/renamed.pdf")!.id;
    expect((await post({ id: first, targetId: target })).status).toBe(204);
    expect((await findBook(first, root, dataDir))?.book.relPath).toBe("c/renamed.pdf");

    expect((await del("nope")).status).toBe(400);
    expect((await del(second)).status).toBe(404);
    await loseBook("b/second.epub", "d/other.epub", "edited second book bytes");
    expect((await del(second)).status).toBe(204);
    expect(await exists(path.join(dataDir, `${second}.json`))).toBe(false);
  });
});

describe("rankCandidates", () => {
  const candidate = (id: string, relPath: string, format: "pdf" | "epub", sizeBytes: number): RelinkCandidate => ({
    id: id.padStart(40, "0") as BookId,
    title: relPath,
    relPath,
    format,
    sizeBytes,
  });

  it("puts the same format first, then the most alike name, then the same size", () => {
    const ranked = rankCandidates({ format: "pdf", relPath: "old/Field Guide to Moss.pdf", sizeBytes: 100 }, [
      candidate("1", "x/Field Guide to Moss.epub", "epub", 100),
      candidate("2", "x/Unrelated Volume.pdf", "pdf", 100),
      candidate("3", "x/field_guide_to_moss (2).pdf", "pdf", 999),
      candidate("4", "y/Unrelated Volume.pdf", "pdf", 5),
    ]);
    expect(ranked.map((book) => book.id.replace(/^0+/, ""))).toEqual(["3", "2", "4", "1"]);
  });
});
