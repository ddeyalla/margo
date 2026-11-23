import type { Thread, TurnUsage } from "./types";

/** A token count from a provider: a whole number of zero or more, or 0 when the field is missing or malformed. */
export const tokenCount = (value: unknown): number => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0);

export const positiveOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);

/** A token count at a glance: 950, 1.2K, 312K, 1M. */
export const formatTokens = (count: number): string => {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${count < 10_000 ? (count / 1000).toFixed(1).replace(/\.0$/, "") : Math.round(count / 1000)}K`;
  return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 1 : 0).replace(/\.0$/, "")}M`;
};

/** Dollars: cents once there are any, otherwise enough places to show a fraction of a cent. */
export const formatCost = (dollars: number): string => {
  if (dollars === 0) return "$0";
  if (dollars >= 0.01) return `$${dollars.toFixed(2)}`;
  return dollars < 0.0001 ? "<$0.0001" : `$${dollars.toFixed(4).replace(/0+$/, "")}`;
};

/** One answer's tokens, ready to list. */
export interface TurnRow {
  /** Index of the answer in the thread's messages. */
  index: number;
  /** Which answer this is, from 1, counting answers that reported nothing. */
  answer: number;
  usage: TurnUsage;
  /** This answer's own tokens. For Codex, the session total less the one before it in the same session. */
  tokens: { input: number; cacheRead: number; cacheWrite: number; output: number };
}

export interface ThreadUsage {
  rows: TurnRow[];
  /** The newest answer's usage: how big the conversation is now. */
  latest: TurnUsage | null;
  /** The thread's cost so far, summed over the answers that have one; null when none does. */
  costUsd: number | null;
  /** Some of that cost is only priced at API rates: the reader's plan pays for it. */
  listPriced: boolean;
  /** Answers with no cost: no usage reported, or a provider that gives none. */
  unpriced: number;
  /** Answers whose provider reported no usage at all, such as those saved before usage was recorded. */
  unreported: number;
}

const own = (usage: TurnUsage) => ({
  input: usage.inputTokens,
  cacheRead: usage.cacheReadTokens,
  cacheWrite: usage.cacheWriteTokens,
  output: usage.outputTokens,
});

/** The thread's usage, answer by answer. */
export const threadUsage = (thread: Thread): ThreadUsage => {
  const rows: TurnRow[] = [];
  /* The last Codex total seen in each session, so the next one can be told apart from it. */
  const totals = new Map<string, TurnUsage>();
  let answers = 0;
  thread.messages.forEach((message, index) => {
    if (message.role !== "assistant") return;
    answers += 1;
    const usage = message.usage;
    if (!usage) return;
    let tokens = own(usage);
    if (usage.scope === "session" && usage.sessionId) {
      const before = totals.get(usage.sessionId);
      if (before) {
        const earlier = own(before);
        tokens = {
          input: Math.max(0, tokens.input - earlier.input),
          cacheRead: Math.max(0, tokens.cacheRead - earlier.cacheRead),
          cacheWrite: Math.max(0, tokens.cacheWrite - earlier.cacheWrite),
          output: Math.max(0, tokens.output - earlier.output),
        };
      }
      totals.set(usage.sessionId, usage);
    }
    rows.push({ index, answer: answers, usage, tokens });
  });
  const priced = rows.map((row) => row.usage).filter((usage) => usage.costUsd !== null);
  return {
    rows,
    latest: rows.at(-1)?.usage ?? null,
    costUsd: priced.length ? priced.reduce((sum, usage) => sum + (usage.costUsd ?? 0), 0) : null,
    listPriced: priced.some((usage) => usage.costBasis === "list"),
    unpriced: answers - rows.filter((row) => row.usage.costUsd !== null).length,
    unreported: answers - rows.length,
  };
};
