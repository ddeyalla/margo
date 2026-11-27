import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { evidenceOf, evidenceStrength, newEvents, type Evidence, type LedgerEvent, type Strength } from "@/lib/shared/ledger";
import { getFolders } from "./config";
import { readBookState, savedBookIds, serializedFile } from "./store";

/** Evidence of what the reader knows, across every book: one JSON object per line. Lines are only ever added. */
export const ledgerFile = (dataDir = getFolders().dataDir) => path.join(/*turbopackIgnore: true*/ dataDir, "ledger.jsonl");

/** The log's events, oldest first by when they happened. A line that isn't JSON, such as one cut off by a crash, is skipped. */
export const readLedger = async (dataDir = getFolders().dataDir): Promise<LedgerEvent[]> => {
  const text = await readFile(ledgerFile(dataDir), "utf8").catch(() => "");
  return text
    .split("\n")
    .flatMap((line) => {
      try {
        return line ? [JSON.parse(line) as LedgerEvent] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.at.localeCompare(b.at));
};

/**
 * Adds the evidence the log doesn't hold yet and returns those events. The file's lock is held from reading the
 * log to adding to it, so the app and an agent's server never add the same event twice or count days from a log
 * the other was changing.
 */
export const recordEvidence = (evidence: readonly Evidence[], dataDir = getFolders().dataDir): Promise<LedgerEvent[]> => {
  if (!evidence.length) return Promise.resolve([]);
  const file = ledgerFile(dataDir);
  return serializedFile(file, async () => {
    const added = newEvents(await readLedger(dataDir), evidence);
    if (added.length) {
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, added.map((event) => `${JSON.stringify(event)}\n`).join(""));
    }
    return added;
  });
};

const pending = new Set<Promise<void>>();

/**
 * Records evidence beside an action of the reader's, without making the action wait and without ever failing it:
 * a ledger that can't be written is logged, and the next action for that book adds what was missed.
 */
export const noteEvidence = (evidence: readonly Evidence[], dataDir?: string): void => {
  const task: Promise<void> = Promise.resolve()
    .then(() => recordEvidence(evidence, dataDir))
    .then(
      () => undefined,
      (error: unknown) => console.error("Could not write the learner ledger:", error),
    )
    .finally(() => pending.delete(task));
  pending.add(task);
};

/** Resolves once every `noteEvidence` so far has been written or given up on. For a process about to exit, and tests. */
export const ledgerIdle = async (): Promise<void> => {
  while (pending.size) await Promise.all(pending);
};

export interface BackfillReport {
  books: number;
  found: number;
  added: number;
  /** What would be added (dry run) or was added, counted by where it came from and by evidence strength. */
  bySource: Record<string, number>;
  byStrength: Partial<Record<Strength, number>>;
}

/**
 * Rebuilds events from what every book's file already holds: card ratings, quiz attempts, draw-it-back attempts,
 * highlights and questions on passages. Running it again adds nothing. With `dryRun` it reads and counts and writes
 * nothing. It only ever appends to the log, and never touches the book files.
 */
export const backfillLedger = async (dataDir = getFolders().dataDir, { dryRun = false }: { dryRun?: boolean } = {}): Promise<BackfillReport> => {
  const ids = [...(await savedBookIds(dataDir))];
  const evidence: Evidence[] = [];
  let books = 0;
  for (const id of ids) {
    /* One unreadable state file is skipped, not a reason to stop. */
    const state = await readBookState(id, dataDir).catch(() => null);
    if (!state) continue;
    books++;
    evidence.push(...evidenceOf(id, state));
  }
  const events = dryRun ? newEvents(await readLedger(dataDir), evidence) : await recordEvidence(evidence, dataDir);
  const bySource: Record<string, number> = {};
  const byStrength: Partial<Record<Strength, number>> = {};
  for (const event of events) {
    bySource[event.source] = (bySource[event.source] ?? 0) + 1;
    const strength = evidenceStrength(event);
    byStrength[strength] = (byStrength[strength] ?? 0) + 1;
  }
  return { books, found: evidence.length, added: events.length, bySource, byStrength };
};
