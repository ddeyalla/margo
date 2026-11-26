import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";

/*
 * A lock between processes, for the JSON files the app and an agent's server both change. Holding
 * `<file>.lock` means: no other process is between reading `<file>` and writing it back. The lock file is made
 * with an exclusive create, which the file system grants to one process only, and holds its owner's process id
 * and a token. The lock is advisory: it stops only writers that take it, which is every writer in this repo.
 *
 * A process that dies holding a lock leaves the file behind. It is taken over when its owner is no longer
 * running, or when nothing has touched it for STALE_MS: a live owner touches its lock every BEAT_MS, so one
 * that stays untouched means a dead owner whose process id went to something else.
 *
 * What is not covered: a process that dies in the few file calls of a takeover leaves its guard behind, and two
 * waiters clearing that guard at the same instant could both take the lock. It takes a crash and a three-way
 * race inside milliseconds; Node has no lock the system itself releases, which is what would close it.
 */

const BEAT_MS = 2_000;
const STALE_MS = 30_000;
/* Taking over a stale lock is done under a second lock held for a few file calls; one this old was abandoned mid-way. */
const TAKEOVER_STALE_MS = 5_000;
const MAX_WAIT_MS = 50;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
const isTaken = (error: unknown) => (error as NodeJS.ErrnoException).code === "EEXIST";

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    /* EPERM: it runs, as another user. */
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Creates the lock file holding `token`, or returns false when it is already there. */
const create = async (lock: string, token: string): Promise<boolean> => {
  for (;;) {
    try {
      const handle = await open(lock, "wx");
      try {
        await handle.writeFile(token);
      } finally {
        await handle.close();
      }
      return true;
    } catch (error) {
      if (isTaken(error)) return false;
      if (!isMissing(error)) throw error;
      await mkdir(path.dirname(lock), { recursive: true });
    }
  }
};

interface Held {
  token: string;
  mtimeMs: number;
}

/** What the lock file holds now and when it was last touched; null when there is none. */
const look = async (lock: string): Promise<Held | null> => {
  try {
    const [token, info] = await Promise.all([readFile(lock, "utf8"), stat(lock)]);
    return { token, mtimeMs: info.mtimeMs };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
};

/* A lock just created has no owner written yet; it counts as owned until it goes quiet. */
const ownerGone = ({ token }: Held): boolean => {
  const pid = Number(token.split(":")[0]);
  return Number.isInteger(pid) && pid > 0 && !isRunning(pid);
};

const quiet = ({ mtimeMs }: Held): boolean => Date.now() - mtimeMs > STALE_MS;

/**
 * Whether the lock was left behind. A quiet lock gets two more beats first: after the machine sleeps every lock
 * looks old, and a live owner touches its own as soon as it wakes.
 */
const abandoned = async (lock: string, held: Held): Promise<boolean> => {
  if (ownerGone(held)) return true;
  if (!quiet(held)) return false;
  await sleep(2 * BEAT_MS);
  const again = await look(lock);
  return again?.token === held.token && again.mtimeMs === held.mtimeMs;
};

/**
 * Removes a lock judged abandoned, unless it changed hands since. Two waiters that both judged the same lock
 * would otherwise each remove what they find and each create their own: the second would delete the first's
 * fresh lock. So the removal is done under a lock of its own, and only of the lock that was judged.
 */
const takeOver = async (lock: string, judged: Held): Promise<void> => {
  const guard = `${lock}.takeover`;
  if (!(await create(guard, `${process.pid}`))) {
    const info = await stat(guard).catch(() => null);
    if (info && Date.now() - info.mtimeMs > TAKEOVER_STALE_MS) await rm(guard, { force: true });
    return;
  }
  try {
    const now = await look(lock);
    if (now?.token === judged.token && (ownerGone(now) || now.mtimeMs === judged.mtimeMs)) await rm(lock, { force: true });
  } finally {
    await rm(guard, { force: true });
  }
};

const acquire = async (lock: string): Promise<() => Promise<void>> => {
  const token = `${process.pid}:${randomBytes(8).toString("hex")}`;
  for (let wait = 1; !(await create(lock, token)); wait = Math.min(wait * 2, MAX_WAIT_MS)) {
    const held = await look(lock);
    if (!held) continue;
    if (await abandoned(lock, held)) await takeOver(lock, held);
    else await sleep(wait + Math.random() * wait);
  }
  const beat = setInterval(() => {
    const now = new Date();
    void utimes(lock, now, now).catch(() => undefined);
  }, BEAT_MS);
  beat.unref();
  return async () => {
    clearInterval(beat);
    /* Only our own lock is removed: one that was taken over as stale now belongs to someone else. A lock that
       can't be looked at is left for the takeover, so a failed release never hides what the task returned. */
    const ours = await look(lock).then(
      (held) => held?.token === token,
      () => false,
    );
    if (ours) await rm(lock, { force: true }).catch(() => undefined);
  };
};

/** Runs `task` while holding the lock for `file` against every other process, waiting for it as long as it takes. */
export const withFileLock = async <T>(file: string, task: () => Promise<T>): Promise<T> => {
  const release = await acquire(`${file}.lock`);
  try {
    return await task();
  } finally {
    await release();
  }
};
