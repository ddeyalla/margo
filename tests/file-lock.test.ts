import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withFileLock } from "@/lib/server/file-lock";
import { holdSaved, readBookState, updateBookState, updateJson } from "@/lib/server/store";
import type { BookId } from "@/lib/shared/types";

const id = "e".repeat(40) as BookId;
const WRITER = path.join(import.meta.dirname, "fixtures/store-writer.mjs");

/** Starts a writer process and waits until it has loaded the store and is ready to go. */
const startWriter = async (dataDir: string, name: string, count: number) => {
  const child = spawn(process.execPath, [WRITER, dataDir, id, name, String(count)], { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`writer ${name} exited with ${code}: ${stderr}`))));
  });
  await new Promise<void>((resolve, reject) => {
    child.stdout.once("data", () => resolve());
    done.catch(reject);
  });
  return { go: () => child.stdin.end("go\n"), done };
};

describe("writes from separate processes", () => {
  it("lose no update when two processes and this one change the same files at once", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "margo-lock-"));
    const each = 40;
    const writers = await Promise.all([startWriter(dir, "one", each), startWriter(dir, "two", each)]);
    const counter = path.join(dir, "counter.json");
    for (const writer of writers) writer.go();
    await Promise.all([
      ...writers.map((writer) => writer.done),
      ...Array.from({ length: each }, (_, n) =>
        Promise.all([
          updateBookState(id, (state) => ({ ...state, threads: [...state.threads, { kind: "general" as const, id: `here-${n}`, anchor: null, chapterTitle: null, provider: "claude" as const, sessionId: null, createdAt: new Date(0).toISOString(), messages: [] }] }), dir),
          updateJson(counter, () => ({ n: 0 }), (current) => ({ n: current.n + 1 })),
        ]),
      ),
    ]);

    const ids = (await readBookState(id, dir)).threads.map((thread) => thread.id);
    expect(ids).toHaveLength(each * 3);
    expect(new Set(ids).size).toBe(each * 3);
    /* Each process's own updates still land in the order it queued them. */
    for (const name of ["one", "two", "here"]) {
      expect(ids.filter((entry) => entry.startsWith(`${name}-`))).toEqual(Array.from({ length: each }, (_, n) => `${name}-${n}`));
    }
    expect(JSON.parse(await readFile(counter, "utf8"))).toEqual({ n: each * 3 });
    expect((await readdir(dir)).filter((name) => name.endsWith(".lock") || name.endsWith(".tmp") || name.endsWith(".takeover"))).toEqual([]);
  }, 30_000);
});

describe("a lock that can't be taken", () => {
  it("fails the write and the hold, and leaves nothing waiting", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "margo-lock-"));
    /* A file where the folder should be: no lock file can be made inside it. */
    const blocked = path.join(dir, "not-a-folder");
    await writeFile(blocked, "");
    await expect(updateJson(path.join(blocked, "data.json"), () => ({}), (current) => current)).rejects.toThrow();
    await expect(holdSaved([id], blocked)).rejects.toThrow();
  });
});

describe("a lock left behind", () => {
  const file = async () => path.join(await mkdtemp(path.join(tmpdir(), "margo-lock-")), "data.json");

  it("is taken over when the process that held it is gone", async () => {
    const target = await file();
    const gone = spawn(process.execPath, ["-e", ""]);
    await new Promise((resolve) => gone.on("exit", resolve));
    await writeFile(`${target}.lock`, `${gone.pid}:abandoned`);
    expect(await updateJson(target, () => ({ n: 0 }), (current) => ({ n: current.n + 1 }))).toEqual({ n: 1 });
  });

  it("is taken over when nothing touches it for a long time, though its owner's process id is in use", async () => {
    const target = await file();
    await writeFile(`${target}.lock`, `${process.pid}:someone-else`);
    const longAgo = new Date(Date.now() - 10 * 60_000);
    await utimes(`${target}.lock`, longAgo, longAgo);
    expect(await withFileLock(target, async () => "ran")).toBe("ran");
  }, 15_000);

  it("is waited for while its owner is alive", async () => {
    const target = await file();
    const order: string[] = [];
    let release!: () => void;
    const first = withFileLock(target, () => new Promise<void>((resolve) => (release = () => (order.push("first done"), resolve()))));
    await expect.poll(() => readFile(`${target}.lock`, "utf8").catch(() => "")).toContain(`${process.pid}:`);
    const second = withFileLock(target, async () => void order.push("second ran"));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(order).toEqual([]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first done", "second ran"]);
  });
});
