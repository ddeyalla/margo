import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { emptyBookState, type BookId, type BookState, type PassageThread, type Position, type Thread } from "@/lib/shared/types";
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

/** The format of every hand-readable JSON file in the data folder. */
export const prettyJson = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const compact = (value: unknown) => JSON.stringify(value) + "\n";

/** Read, change and write one file inside its queue, so two updates never lose each other's fields. */
export const updateJson = <T>(
  file: string,
  fallback: () => T,
  change: (current: T) => T,
  format: (value: T) => string = prettyJson,
): Promise<T> =>
  serialized(file, async () => {
    const next = change((await readJson<T>(file)) ?? fallback());
    await writeFileAtomic(file, format(next));
    return next;
  });

const stateFile = (id: BookId, dataDir: string) => path.join(/*turbopackIgnore: true*/ dataDir, `${id}.json`);

/**
 * Where the reader is and when they last moved, in a file of its own: the
 * position is saved at every scroll stop, and the state file holds every
 * thread and message, too much to rewrite that often.
 */
const positionFile = (id: BookId, dataDir: string) => path.join(/*turbopackIgnore: true*/ dataDir, `${id}.position.json`);

type SavedPosition = Pick<BookState, "position" | "lastReadAt">;

/** Threads saved before questions without a passage existed have no kind; every one of them is about a passage. */
type StoredThread = Thread | Omit<PassageThread, "kind">;
/* `cards` held an earlier card shape that was never filled; it is dropped on read. */
type StoredState = Omit<BookState, "threads"> & { threads: StoredThread[]; cards?: unknown };

const normalize = (raw: Partial<StoredState> | null): BookState => {
  const state = { ...emptyBookState(), ...raw };
  delete state.cards;
  return { ...state, threads: state.threads.map((thread) => ("kind" in thread ? thread : { ...thread, kind: "passage" })) };
};

/* Books read before the position had its own file keep it in the state file; that copy counts until the first position save. */
const withPosition = (state: BookState, saved: SavedPosition | null): BookState =>
  saved ? { ...state, position: saved.position ?? null, lastReadAt: saved.lastReadAt ?? null } : state;

const readPosition = (id: BookId, dataDir: string) => readJson<SavedPosition>(positionFile(id, dataDir));

export const readBookState = async (id: BookId, dataDir = getConfig().dataDir): Promise<BookState> => {
  const [raw, saved] = await Promise.all([readJson<Partial<StoredState>>(stateFile(id, dataDir)), readPosition(id, dataDir)]);
  return withPosition(normalize(raw), saved);
};

/** Saves where the reader is, as of `at`, without touching the rest of the book's state. */
export const saveBookPosition = (id: BookId, position: Position, dataDir = getConfig().dataDir, at = new Date()): Promise<void> => {
  const file = positionFile(id, dataDir);
  const saved: SavedPosition = { position, lastReadAt: at.toISOString() };
  return serialized(file, () => writeFileAtomic(file, compact(saved)));
};

/**
 * Changes the book's state. `change` sees the position merged in like any
 * reader does. Once the position has its own file, the state file is written
 * without one so no stale copy lingers there, and a change that moves the
 * position (no route does; tests and scripts may) is written to that file.
 */
export const updateBookState = (
  id: BookId,
  change: (state: BookState) => BookState,
  dataDir = getConfig().dataDir,
): Promise<BookState> => {
  const file = stateFile(id, dataDir);
  return serialized(file, async () => {
    const saved = await readPosition(id, dataDir);
    const current = withPosition(normalize(await readJson<Partial<StoredState>>(file)), saved);
    const next = change(current);
    if (!saved) {
      await writeFileAtomic(file, compact(next));
      return next;
    }
    const { position, lastReadAt, ...rest } = next;
    if (position !== current.position || lastReadAt !== current.lastReadAt) {
      const target = positionFile(id, dataDir);
      await serialized(target, () => writeFileAtomic(target, compact({ position, lastReadAt } satisfies SavedPosition)));
    }
    await writeFileAtomic(file, compact(rest));
    return next;
  });
};

const mtime = async (file: string): Promise<number | null> => {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return null;
  }
};

/** When the book's state or position last changed, or null if it was never opened. */
export const bookStateUpdatedAt = async (id: BookId, dataDir = getConfig().dataDir): Promise<Date | null> => {
  const times = (await Promise.all([mtime(stateFile(id, dataDir)), mtime(positionFile(id, dataDir))])).filter((t) => t !== null);
  return times.length ? new Date(Math.max(...times)) : null;
};

/** Whether anything is saved for the book: a state file or a position file. */
export const hasSavedData = async (id: BookId, dataDir = getConfig().dataDir): Promise<boolean> =>
  (await bookStateUpdatedAt(id, dataDir)) !== null;

/* Only finished files: an atomic write's temp file is `<id>.json.<pid>.<hex>.tmp`, which is not saved data. */
const SAVED_FILE = /^([0-9a-f]{40})(?:\.position)?\.json$/;

/** Every book id with a state or position file in the data folder. */
export const savedBookIds = async (dataDir = getConfig().dataDir): Promise<Set<BookId>> => {
  let names: string[];
  try {
    names = await readdir(dataDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw error;
  }
  return new Set(names.flatMap((name) => SAVED_FILE.exec(name)?.[1] ?? []) as BookId[]);
};

/** Deletes the book's state and position files, each inside its own queue so no queued write lands after it. */
export const deleteBookState = async (id: BookId, dataDir = getConfig().dataDir): Promise<void> => {
  await Promise.all([stateFile(id, dataDir), positionFile(id, dataDir)].map((file) => serialized(file, () => rm(file, { force: true }))));
};
