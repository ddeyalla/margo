import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "@/app/api/library/missing/[id]/route";
import { GET, POST } from "@/app/api/library/missing/route";
import { bookIdOf, findBook, readLibrary, scanLibrary } from "@/lib/server/library";
import { readIndex } from "@/lib/server/library-index";
import { forget, listMissing, MissingBookError, rebind } from "@/lib/server/missing-books";
import { BookClosedError, saveBookPosition } from "@/lib/server/store";
import { rankCandidates, type RelinkCandidate } from "@/lib/shared/relink";
import type { BookId } from "@/lib/shared/types";

/* Outside a request there is no render to mark dynamic. */
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => undefined }));

/* A rename the test picks fails once, so a move part-way through can be checked, and a folder listing the test
   picks runs a callback once, so a write can be started at a known point. Every other call is the real one. */
const fsHook = vi.hoisted(() => ({
  failRename: null as ((from: string, to: string) => boolean) | null,
  onReaddir: null as ((dir: string) => boolean) | null,
}));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  const rename: typeof actual.rename = async (from, to) => {
    if (fsHook.failRename?.(String(from), String(to))) {
      fsHook.failRename = null;
      throw Object.assign(new Error("Simulated I/O error"), { code: "EIO" });
    }
    return actual.rename(from, to);
  };
  const readdir = ((dir: string, ...rest: unknown[]) => {
    if (fsHook.onReaddir?.(String(dir))) fsHook.onReaddir = null;
    return (actual.readdir as (...args: unknown[]) => unknown)(dir, ...rest);
  }) as typeof actual.readdir;
  return { ...actual, rename, readdir, default: { ...actual, rename, readdir } };
});

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
  const base = await mkdtemp(path.join(tmpdir(), "margo-missing-"));
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
  fsHook.failRename = null;
  fsHook.onReaddir = null;
});

const missingNow = async () => (await listMissing(await readLibrary(root, dataDir), dataDir)).missing;

const indexNow = async () => (await readIndex(path.join(dataDir, "library.json"))) ?? {};

/** Every file under `dir` but the index, which background hashing may be rewriting, by its path relative to `dir`, with its contents. */
const filesUnder = async (dir: string): Promise<Record<string, string>> => {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  const files = entries.filter((entry) => entry.isFile() && !entry.name.startsWith("library.json"));
  return Object.fromEntries(
    await Promise.all(
      files.map(async (entry) => {
        const file = path.join(entry.parentPath, entry.name);
        return [path.relative(dir, file), await readFile(file, "utf8")] as const;
      }),
    ),
  );
};

const position = { kind: "pdf", page: 3, offset: 0, fraction: 0.1 } as const;

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

    const missing = await missingNow();
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

    const { candidates } = await listMissing(await readLibrary(root, dataDir), dataDir);
    expect(candidates.map((book) => book.relPath)).toEqual(["c/renamed.pdf"]);
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

    const missing = await missingNow();
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ id: first, title: "first.pdf", format: "pdf" });
  });

  it("lists nothing when the books folder is empty, because that proves no book is gone", async () => {
    const { first } = await seedTwo();
    await rm(path.join(root, "a"), { recursive: true });
    await rm(path.join(root, "b"), { recursive: true });
    expect(await missingNow()).toEqual([]);
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
    expect(await missingNow()).toEqual([]);
    /* The next scan keeps the binding. */
    expect((await scanLibrary(root, dataDir)).find((book) => book.relPath === "c/renamed.pdf")?.id).toBe(first);
  });

  it("refuses a file in another format, a file with saved data of its own, a book that is not missing, and a file that is not there", async () => {
    const { first, second } = await seedTwo();
    await expect(rebind(first, second, root, dataDir)).rejects.toMatchObject({ problem: "not_missing" });

    await loseBook("a/first.pdf", "c/renamed.pdf", "edited first book bytes");
    await expect(rebind(first, second, root, dataDir)).rejects.toMatchObject({ problem: "format_mismatch" });
    const renamed = (await scanLibrary(root, dataDir)).find((book) => book.relPath === "c/renamed.pdf")!.id;
    await writeFile(path.join(dataDir, `${renamed}.json`), stateOf(renamed));
    await expect(rebind(first, renamed, root, dataDir)).rejects.toMatchObject({ problem: "target_has_data" });
    await expect(rebind(first, unknownId, root, dataDir)).rejects.toMatchObject({ problem: "target_not_found" });
    await expect(rebind(first, first, root, dataDir)).rejects.toBeInstanceOf(MissingBookError);
    expect((await findBook(second, root, dataDir))?.book.relPath).toBe("b/second.epub");
    expect((await indexNow())[first]?.missingSince).toEqual(expect.any(Number));
  });

  it("takes the format from the last path when nothing saved records it, and relinks across formats when neither does", async () => {
    await write(root, "a/first.pdf", "first book bytes");
    await write(root, "b/second.epub", "second book bytes, longer");
    await scanLibrary(root, dataDir);
    const first = bookIdOf("a/first.pdf");
    const second = bookIdOf("b/second.epub");
    await writeFile(path.join(dataDir, `${first}.position.json`), JSON.stringify({ position, lastReadAt: null }));
    const stray = "fedcba9876543210fedcba9876543210fedcba98" as BookId;
    await writeFile(path.join(dataDir, `${stray}.position.json`), JSON.stringify({ position, lastReadAt: null }));
    await loseBook("a/first.pdf", "c/renamed.pdf", "edited first book bytes");

    await expect(rebind(first, second, root, dataDir)).rejects.toMatchObject({ problem: "format_mismatch" });
    await rebind(stray, second, root, dataDir);
    expect((await findBook(stray, root, dataDir))?.book.relPath).toBe("b/second.epub");
  });
});

describe("rebind racing a save", () => {
  const lostWithTarget = async () => {
    const { first } = await seedTwo();
    await loseBook("a/first.pdf", "c/renamed.pdf", "edited first book bytes");
    const target = (await scanLibrary(root, dataDir)).find((book) => book.relPath === "c/renamed.pdf")!.id;
    return { first, target, positionFile: path.join(dataDir, `${target}.position.json`) };
  };

  it("refuses the relink when a save for the target was queued first, and keeps both", async () => {
    const { first, target, positionFile } = await lostWithTarget();
    const saving = saveBookPosition(target, position, dataDir);
    await expect(rebind(first, target, root, dataDir)).rejects.toMatchObject({ problem: "target_has_data" });
    await saving;
    expect(await exists(positionFile)).toBe(true);
    expect((await indexNow())[target]).toBeDefined();
  });

  it("refuses a save that found the target before the relink and lands after it", async () => {
    const { first, target, positionFile } = await lostWithTarget();
    await rebind(first, target, root, dataDir);
    await expect(saveBookPosition(target, position, dataDir)).rejects.toBeInstanceOf(BookClosedError);
    expect(await exists(positionFile)).toBe(false);
    /* The book keeps taking saves under the id it was given. */
    await saveBookPosition(first, position, dataDir);
  });

  it("makes a save that starts between the relink's check and its commit wait, then refuses it", async () => {
    const { first, target, positionFile } = await lostWithTarget();
    let saving: Promise<string> | null = null;
    /* The relink lists the data folder for saved ids only once it holds the queues. */
    fsHook.onReaddir = (dir) => {
      if (dir !== dataDir) return false;
      saving = saveBookPosition(target, position, dataDir).then(
        () => "saved",
        (error: Error) => error.name,
      );
      return true;
    };
    await rebind(first, target, root, dataDir);
    expect(await saving).toBe("BookClosedError");
    expect(await exists(positionFile)).toBe(false);
  });

  it("never leaves a target's saved file without an index entry, whichever lands first", async () => {
    /* The save starts a little later each time, so some land before the relink's check and some while it holds the queues. */
    for (let ticks = 0; ticks <= 40; ticks += 2) {
      const base = await mkdtemp(path.join(tmpdir(), "margo-race-"));
      root = path.join(base, "books");
      dataDir = path.join(base, "data");
      await Promise.all([mkdir(root), mkdir(dataDir)]);
      const { first, target, positionFile } = await lostWithTarget();
      const relinking = rebind(first, target, root, dataDir).then(
        () => "relinked",
        (error: MissingBookError) => error.problem,
      );
      for (let tick = 0; tick < ticks; tick += 1) await new Promise((resolve) => setImmediate(resolve));
      const saving = saveBookPosition(target, position, dataDir).then(
        () => "saved",
        (error: Error) => error.name,
      );
      const outcome = [await relinking, await saving];
      expect([
        ["relinked", "BookClosedError"],
        ["target_has_data", "saved"],
      ]).toContainEqual(outcome);
      if (await exists(positionFile)) expect((await indexNow())[target]).toBeDefined();
    }
  });
});

describe("forget", () => {
  it("moves exactly the missing book's files to its forgotten folder and drops its index entry", async () => {
    const { first, second } = await seedTwo();
    await writeFile(path.join(dataDir, `${first}.position.json`), JSON.stringify({ position: null, lastReadAt: null }));
    await writeFile(path.join(dataDir, `${second}.json`), stateOf(second));
    await mkdir(path.join(dataDir, "covers"), { recursive: true });
    await mkdir(path.join(dataDir, "attachments", first), { recursive: true });
    await mkdir(path.join(dataDir, "attachments", second), { recursive: true });
    for (const id of [first, second]) {
      await writeFile(path.join(dataDir, "covers", `${id}.jpg`), `cover of ${id}`);
      await writeFile(path.join(dataDir, "attachments", id, "0123456789abcdef0123456789abcdef.png"), `image of ${id}`);
    }
    await write(notesDir, "First book.md", `---\nbookId: ${first}\n---\n`);
    await loseBook("a/first.pdf", "c/renamed.pdf", "edited first book bytes");
    const before = await filesUnder(dataDir);
    const kept = (file: string) => file.includes(first);

    await forget(first, root, dataDir);

    const folders = await readdir(path.join(dataDir, "forgotten"));
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatch(new RegExp(`^${first}-\\d+$`));
    const trashed = await filesUnder(path.join(dataDir, "forgotten", folders[0]));
    expect(trashed).toEqual(Object.fromEntries(Object.entries(before).filter(([file]) => kept(file))));
    const after = await filesUnder(dataDir);
    expect(Object.keys(after).filter((file) => kept(file) && !file.startsWith("forgotten"))).toEqual([]);
    for (const [file, content] of Object.entries(before)) {
      if (!kept(file)) expect(after[file]).toBe(content);
    }
    expect((await indexNow())[first]).toBeUndefined();
    expect(await readFile(path.join(notesDir, "First book.md"), "utf8")).toContain(first);
    expect(await missingNow()).toEqual([]);
  });

  it("keeps a book listed when a move fails part-way, and a retry finishes without losing a file", async () => {
    const { first } = await seedTwo();
    await writeFile(path.join(dataDir, `${first}.position.json`), JSON.stringify({ position, lastReadAt: null }));
    await mkdir(path.join(dataDir, "covers"), { recursive: true });
    await writeFile(path.join(dataDir, "covers", `${first}.jpg`), "cover");
    await mkdir(path.join(dataDir, "attachments", first), { recursive: true });
    await writeFile(path.join(dataDir, "attachments", first, "0123456789abcdef0123456789abcdef.png"), "image");
    await loseBook("a/first.pdf", "c/renamed.pdf", "edited first book bytes");
    const before = Object.fromEntries(Object.entries(await filesUnder(dataDir)).filter(([file]) => file.includes(first)));
    fsHook.failRename = (from, to) => to.includes("forgotten") && from.endsWith(".position.json");

    await expect(forget(first, root, dataDir)).rejects.toMatchObject({ problem: "not_moved" });
    expect(await exists(path.join(dataDir, `${first}.json`))).toBe(true);
    expect((await missingNow()).map((book) => book.id)).toEqual([first]);
    expect((await indexNow())[first]).toBeDefined();

    await forget(first, root, dataDir);
    const trash = path.join(dataDir, "forgotten");
    const folders = await readdir(trash);
    expect(folders).toHaveLength(2);
    const moved = Object.assign({}, ...(await Promise.all(folders.map((folder) => filesUnder(path.join(trash, folder))))));
    expect(moved).toEqual(before);
    expect(Object.keys(await filesUnder(dataDir)).filter((file) => file.includes(first) && !file.startsWith("forgotten"))).toEqual([]);
    expect((await indexNow())[first]).toBeUndefined();
    await expect(saveBookPosition(first, position, dataDir)).rejects.toBeInstanceOf(BookClosedError);
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
    const body = (await listed.json()) as { missing: { id: string }[]; candidates: { id: string }[] };
    expect(body.missing.map((book) => book.id)).toEqual([first]);
    expect(body.candidates).toHaveLength(2);

    expect((await post({ id: first })).status).toBe(400);
    expect((await post({ id: "nope", targetId: second })).status).toBe(400);
    expect((await post({ id: unknownId, targetId: second })).status).toBe(404);
    expect((await post({ id: first, targetId: unknownId })).status).toBe(404);
    expect((await post({ id: first, targetId: second })).status).toBe(409);

    const target = (await scanLibrary(root, dataDir)).find((book) => book.relPath === "c/renamed.pdf")!.id;
    expect((await post({ id: first, targetId: target })).status).toBe(204);
    expect((await findBook(first, root, dataDir))?.book.relPath).toBe("c/renamed.pdf");

    expect((await del("nope")).status).toBe(400);
    await writeFile(path.join(dataDir, `${second}.json`), stateOf(second));
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
  const books = [
    candidate("1", "x/Field Guide to Moss.epub", "epub", 100),
    candidate("2", "x/Unrelated Volume.pdf", "pdf", 100),
    candidate("3", "x/field_guide_to_moss (2).pdf", "pdf", 999),
    candidate("4", "y/Unrelated Volume.pdf", "pdf", 5),
  ];
  const ids = (ranked: RelinkCandidate[]) => ranked.map((book) => book.id.replace(/^0+/, ""));

  it("keeps only the missing book's format, then puts the most alike name first, then the same size", () => {
    expect(ids(rankCandidates({ format: "pdf", relPath: "old/Field Guide to Moss.pdf", sizeBytes: 100 }, books))).toEqual(["3", "2", "4"]);
  });

  it("keeps every format when the missing book's is not known", () => {
    expect(ids(rankCandidates({ format: null, relPath: "old/Field Guide to Moss", sizeBytes: null }, books))).toEqual(["1", "3", "2", "4"]);
  });
});
