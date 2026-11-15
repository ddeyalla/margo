import { mkdtemp, readdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bookStateUpdatedAt, readBookState, saveBookPosition, updateBookState } from "@/lib/server/store";
import { emptyBookState, type BookId, type Position, type Thread } from "@/lib/shared/types";

const id = "a".repeat(40) as BookId;

const thread = (n: number): Thread => ({
  kind: "passage",
  id: `t${n}`,
  anchor: { kind: "epub", cfi: `epubcfi(/6/${n})` },
  quote: `quote ${n}`,
  before: "",
  after: "",
  chapterTitle: null,
  action: "explain",
  provider: "claude",
  sessionId: null,
  createdAt: new Date(0).toISOString(),
  messages: [],
});

describe("book state store", () => {
  it("starts empty for a book that was never opened", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-store-"));
    expect(await readBookState(id, dir)).toMatchObject({ meta: null, position: null, threads: [], activeThreadId: null });
  });

  it("keeps every concurrent update and leaves valid JSON", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-store-"));
    await Promise.all([
      ...Array.from({ length: 20 }, (_, n) =>
        updateBookState(id, (state) => ({ ...state, threads: [...state.threads, thread(n)] }), dir),
      ),
      updateBookState(id, (state) => ({ ...state, position: { kind: "epub", cfi: "epubcfi(/6/2)", fraction: 0.5 } }), dir),
    ]);

    const raw = JSON.parse(await readFile(path.join(dir, `${id}.json`), "utf8"));
    expect(raw.threads).toHaveLength(20);
    expect(raw.position).toEqual({ kind: "epub", cfi: "epubcfi(/6/2)", fraction: 0.5 });
    expect(await readdir(dir)).toEqual([`${id}.json`]);
  });

  it("reads threads saved before questions without a passage existed as passage threads", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-store-"));
    const old: Record<string, unknown> = { ...thread(1) };
    delete old.kind;
    await writeFile(path.join(dir, `${id}.json`), JSON.stringify({ threads: [old] }));
    expect((await readBookState(id, dir)).threads).toEqual([thread(1)]);
    const updated = await updateBookState(id, (state) => state, dir);
    expect(updated.threads[0].kind).toBe("passage");
  });
});

describe("reading position", () => {
  const oldPosition: Position = { kind: "epub", cfi: "epubcfi(/6/4)", fraction: 0.25 };
  const newPosition: Position = { kind: "epub", cfi: "epubcfi(/6/8)", fraction: 0.75 };
  const stateFile = (dir: string) => path.join(dir, `${id}.json`);

  /* A book read before the position had its own file: everything, position included, in one pretty-printed file. */
  const writeOldState = async (dir: string) => {
    const old = { ...emptyBookState(), threads: [thread(1)], position: oldPosition, lastReadAt: "2026-01-01T00:00:00.000Z" };
    await writeFile(stateFile(dir), JSON.stringify(old, null, 2) + "\n");
    /* Back-date it so a later write would show in the mtime even on a coarse clock. */
    await utimes(stateFile(dir), new Date("2026-01-01"), new Date("2026-01-01"));
  };

  it("reads the position kept inside an older state file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-store-"));
    await writeOldState(dir);
    expect(await readBookState(id, dir)).toMatchObject({ position: oldPosition, lastReadAt: "2026-01-01T00:00:00.000Z" });
    expect((await readBookState(id, dir)).threads).toEqual([thread(1)]);
  });

  it("saves the position without touching the state file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-store-"));
    await writeOldState(dir);
    const before = await readFile(stateFile(dir));
    const beforeTime = (await stat(stateFile(dir))).mtimeMs;

    const at = new Date("2026-03-01T12:00:00.000Z");
    await saveBookPosition(id, newPosition, dir, at);

    expect(await readFile(stateFile(dir))).toEqual(before);
    expect((await stat(stateFile(dir))).mtimeMs).toBe(beforeTime);
    expect(await readBookState(id, dir)).toMatchObject({ position: newPosition, lastReadAt: at.toISOString(), threads: [thread(1)] });
  });

  it("keeps the saved position through later state changes and drops the stale copy from the state file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-store-"));
    await writeOldState(dir);
    await saveBookPosition(id, newPosition, dir);
    await updateBookState(id, (state) => ({ ...state, threads: [...state.threads, thread(2)] }), dir);

    const raw = JSON.parse(await readFile(stateFile(dir), "utf8"));
    expect(raw.threads).toHaveLength(2);
    expect(raw).not.toHaveProperty("position");
    expect((await readBookState(id, dir)).position).toEqual(newPosition);
  });

  it("moves the last-changed time forward on a position save", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-store-"));
    await writeOldState(dir);
    const before = await bookStateUpdatedAt(id, dir);
    expect(before?.toISOString()).toBe(new Date("2026-01-01").toISOString());

    await saveBookPosition(id, newPosition, dir);
    const after = await bookStateUpdatedAt(id, dir);
    expect(after!.getTime()).toBeGreaterThan(before!.getTime());
  });

  it("counts a book whose only saved state is its position as opened", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-store-"));
    expect(await bookStateUpdatedAt(id, dir)).toBeNull();
    await saveBookPosition(id, newPosition, dir);
    expect(await bookStateUpdatedAt(id, dir)).not.toBeNull();
    expect((await readBookState(id, dir)).position).toEqual(newPosition);
  });
});
