import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { emptyBookState, type BookId, type BookState } from "@/lib/shared/types";
import { getConfig } from "./config";

/**
 * Writers queue per file. The map lives on globalThis because the dev server
 * loads a separate copy of this module for each route; a module-level map
 * would let /api/chat and /api/books/.../state write the same file at once.
 */
const QUEUES: unique symbol = Symbol.for("rigg-learn.store.queues");
type GlobalWithQueues = typeof globalThis & { [QUEUES]?: Map<string, Promise<unknown>> };
const queues = ((globalThis as GlobalWithQueues)[QUEUES] ??= new Map());

/** Runs tasks with the same key one after another, in the order they were queued. */
export const serialized = <T>(key: string, task: () => Promise<T>): Promise<T> => {
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.catch(() => undefined);
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
};

/** Waits until no one else holds `key`, then holds it until the returned release is called. */
export const hold = (key: string): Promise<() => void> =>
  new Promise((acquired) => {
    void serialized(key, () => new Promise<void>((release) => acquired(release)));
  });

export const readJson = async <T>(file: string): Promise<T | null> => {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return JSON.parse(text) as T;
};

/** Write to a unique temp file beside the target, then rename over it. Readers see the old file or the new one. */
export const writeFileAtomic = async (file: string, content: string | Uint8Array): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temp, content);
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
};

/** Read, change and write one file inside its queue, so two updates never lose each other's fields. */
export const updateJson = <T>(file: string, fallback: () => T, change: (current: T) => T): Promise<T> =>
  serialized(file, async () => {
    const next = change((await readJson<T>(file)) ?? fallback());
    await writeFileAtomic(file, JSON.stringify(next, null, 2) + "\n");
    return next;
  });

const stateFile = (id: BookId, dataDir: string) => path.join(dataDir, `${id}.json`);

const normalize = (raw: Partial<BookState> | null): BookState => ({ ...emptyBookState(), ...raw });

export const readBookState = async (id: BookId, dataDir = getConfig().dataDir): Promise<BookState> =>
  normalize(await readJson<Partial<BookState>>(stateFile(id, dataDir)));

export const updateBookState = (
  id: BookId,
  change: (state: BookState) => BookState,
  dataDir = getConfig().dataDir,
): Promise<BookState> =>
  updateJson<BookState>(stateFile(id, dataDir), emptyBookState, (current) => change(normalize(current)));

/** When the book's state last changed, or null if it was never opened. */
export const bookStateUpdatedAt = async (id: BookId, dataDir = getConfig().dataDir): Promise<Date | null> => {
  try {
    return (await stat(stateFile(id, dataDir))).mtime;
  } catch {
    return null;
  }
};
