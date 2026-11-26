import type { Board } from "./boards";
import { compareAnchors } from "./annotations";
import { SURE } from "./confidence";
import { isParked } from "./parked";
import type { ChapterQuiz } from "./quiz";
import { recallAt, replaySchedule } from "./schedule";
import type { Anchor, BookId, BookState, CardSet, Highlight, Rating, Thread } from "./types";

/*
 * The learner ledger: one line per piece of evidence about what the reader knows, across every book. The log only
 * grows. What the reader holds, is shaky on or never checked is worked out from it when asked and never stored,
 * so it can't be inflated and it fades when they stop checking.
 */

export const LEDGER_SOURCES = ["highlight", "ask", "card", "quiz", "explain-back", "board", "focus-recall", "parked"] as const;
export type LedgerSource = (typeof LEDGER_SOURCES)[number];

export interface LedgerEvent {
  /** Names the thing that happened, so recording it twice keeps one line. */
  id: string;
  /** When it happened, an ISO time. */
  at: string;
  bookId: string;
  /** What the evidence is about: a passage by its anchor, a quiz question, a board, or a topic an agent named. */
  item: string;
  anchor: Anchor | null;
  chapter: string | null;
  source: LedgerSource;
  /** How well the reader did, from 0 to 1, or null when they only met the material. */
  outcome: number | null;
  /** They answered from memory, with nothing to pick from and no hint. */
  unaided: boolean;
  /** How much help they had: 0 for none. */
  hintLevel: number;
  /** Days since they last met this item, or null when this is the first time. */
  daysSince: number | null;
  /** How sure they said they were before seeing the answer, from 0 to 100, when asked. */
  confidence: number | null;
  /** What it is about, in words already stored: a card's fact, a quiz question, a highlighted line. */
  topic: string;
}

/** An event before it is written. `exposedAt` is when the reader first met the item, if that left no event of its own. */
export type Evidence = Omit<LedgerEvent, "daysSince"> & { exposedAt?: string };

/* Evidence strength. */

export type Strength = "strong" | "medium" | "weak" | "exposure";

/**
 * How much one event says about memory. Recalling something unaided a day or more after last meeting it is the
 * only strong evidence; the same on the day itself may be short-term memory; anything hinted or picked from
 * options is weak; meeting the material is no test at all.
 */
export const evidenceStrength = (event: Pick<LedgerEvent, "outcome" | "unaided" | "hintLevel" | "daysSince">): Strength => {
  if (event.outcome === null) return "exposure";
  if (!event.unaided || event.hintLevel > 0) return "weak";
  return event.daysSince !== null && event.daysSince >= 1 ? "strong" : "medium";
};

/* What the app's own records say, as evidence. The live paths and the backfill both build events here, so they agree. */

const MAX_TOPIC = 240;
const topicOf = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > MAX_TOPIC ? `${line.slice(0, MAX_TOPIC - 1)}…` : line;
};

export const anchorItem = (anchor: Anchor) => `anchor:${anchor.kind === "epub" ? anchor.cfi : `p${anchor.page}:${anchor.start}-${anchor.end}`}`;

/** An item an agent names by topic alone. */
export const topicItem = (topic: string) => `topic:${topic.toLowerCase().replace(/\W+/g, " ").trim()}`;

/** A rating as an outcome: Again is a miss, Hard a pass with effort. */
const RATING_OUTCOME: Record<Rating, number> = { again: 0, hard: 0.6, good: 1, easy: 1 };

const cardEvidence = (bookId: BookId, set: CardSet): Evidence[] =>
  (set.history ?? []).map((record) => ({
    id: `${bookId}:card:${set.id}:${record.at}`,
    at: record.at,
    bookId,
    item: anchorItem(set.anchor),
    anchor: set.anchor,
    chapter: set.chapterTitle,
    source: "card",
    outcome: RATING_OUTCOME[record.rating],
    unaided: true,
    hintLevel: 0,
    confidence: record.confidence,
    topic: topicOf(set.fact),
    exposedAt: set.createdAt,
  }));

const quizEvidence = (bookId: BookId, quiz: ChapterQuiz): Evidence[] =>
  quiz.attempts.flatMap((attempt) =>
    attempt.answers.flatMap((answer) => {
      const question = quiz.questions.find((entry) => entry.id === answer.questionId);
      if (!question) return [];
      return {
        id: `${bookId}:quiz:${quiz.chapter}:${question.id}:${attempt.at}`,
        at: attempt.at,
        bookId,
        item: `quiz:${quiz.chapter}:${question.id}`,
        anchor: question.anchor,
        chapter: quiz.chapter,
        source: "quiz" as const,
        outcome: answer.correct ? 1 : 0,
        unaided: true,
        hintLevel: 0,
        confidence: answer.confidence,
        topic: topicOf(question.question),
        exposedAt: quiz.createdAt,
      };
    }),
  );

const boardEvidence = (bookId: BookId, board: Board): Evidence[] =>
  board.attempts.map((attempt) => ({
    id: `${bookId}:board:${board.id}:${attempt.at}`,
    at: attempt.at,
    bookId,
    item: `board:${board.id}`,
    anchor: null,
    chapter: board.chapter,
    source: "board",
    outcome: attempt.correct ? 1 : 0,
    unaided: true,
    hintLevel: 0,
    confidence: null,
    topic: topicOf(`Whiteboard: ${board.title}`),
  }));

const exposure = { outcome: null, unaided: false, hintLevel: 0, confidence: null } as const;

const highlightEvidence = (bookId: BookId, highlight: Highlight): Evidence => ({
  id: `${bookId}:highlight:${highlight.id}`,
  at: highlight.createdAt,
  bookId,
  item: anchorItem(highlight.anchor),
  anchor: highlight.anchor,
  chapter: highlight.chapterTitle,
  source: "highlight",
  ...exposure,
  topic: topicOf(highlight.quote),
});

/**
 * A thread on a passage, as one meeting with it: a parked question, an explain-back, or any other question to the
 * tutor. An explain-back has no grade stored, so it counts as meeting the passage and no more.
 */
export const threadEvidence = (bookId: BookId, thread: Thread): Evidence[] => {
  if (thread.kind !== "passage") return [];
  const question = thread.action === "ask" || thread.action === "explainBack" ? thread.messages.find((message) => message.role === "user")?.content : null;
  return [
    {
      id: `${bookId}:thread:${thread.id}`,
      at: thread.createdAt,
      bookId,
      item: anchorItem(thread.anchor),
      anchor: thread.anchor,
      chapter: thread.chapterTitle,
      source: isParked(thread) ? "parked" : thread.action === "explainBack" ? "explain-back" : "ask",
      ...exposure,
      topic: topicOf(question || thread.quote),
    },
  ];
};

/** Everything a book's saved state says about what the reader met and how they did, oldest first. */
export const evidenceOf = (bookId: BookId, state: Pick<BookState, "highlights" | "threads" | "cardSets" | "quizzes" | "boards">): Evidence[] =>
  [
    ...state.highlights.map((highlight) => highlightEvidence(bookId, highlight)),
    ...state.threads.flatMap((thread) => threadEvidence(bookId, thread)),
    ...state.cardSets.flatMap((set) => cardEvidence(bookId, set)),
    ...state.quizzes.flatMap((quiz) => quizEvidence(bookId, quiz)),
    ...state.boards.flatMap((board) => boardEvidence(bookId, board)),
  ].sort((a, b) => a.at.localeCompare(b.at));

/* Writing. */

const DAY_MS = 86_400_000;
const itemKey = (event: Pick<LedgerEvent, "bookId" | "item">) => `${event.bookId}\n${event.item}`;

/**
 * The events to add to a log for some evidence: those it doesn't hold yet, each with the days since the reader
 * last met its item. That is read from times, not from the order of lines, so old evidence added late still
 * counts from what came before it.
 */
export const newEvents = (log: readonly LedgerEvent[], evidence: readonly Evidence[]): LedgerEvent[] => {
  const known = new Set(log.map((event) => event.id));
  const met = new Map<string, number[]>();
  const meet = (key: string, time: number) => met.set(key, [...(met.get(key) ?? []), time]);
  for (const event of log) meet(itemKey(event), Date.parse(event.at));
  const added: LedgerEvent[] = [];
  for (const { exposedAt, ...draft } of [...evidence].sort((a, b) => a.at.localeCompare(b.at))) {
    if (known.has(draft.id)) continue;
    known.add(draft.id);
    const at = Date.parse(draft.at);
    const key = itemKey(draft);
    const before = [...(met.get(key) ?? []), ...(exposedAt ? [Date.parse(exposedAt)] : [])].filter((time) => time < at);
    const daysSince = before.length ? Math.round(((at - Math.max(...before)) / DAY_MS) * 1000) / 1000 : null;
    added.push({ ...draft, daysSince });
    meet(key, at);
  }
  return added;
};

/* The derived view. */

export type KnowledgeState = "held" | "shaky" | "untested";

/** An outcome at or above this counts as getting it right. */
export const PASS = 0.6;

/**
 * Predicted recall an item must still have to stay held. The scheduler brings a card back when recall falls to
 * 0.9; held allows for being somewhat overdue, and gives way after that.
 */
export const HELD_RECALL = 0.8;

export interface LedgerItem {
  bookId: string;
  item: string;
  topic: string;
  chapter: string | null;
  anchor: Anchor | null;
  state: KnowledgeState;
  /** One line on why it is in that state. */
  why: string;
  /** Predicted recall now, from 0 to 1, replaying its checks through the card scheduler. Null before any check. */
  recall: number | null;
  /** The last check's outcome and when, or null before any. */
  lastOutcome: number | null;
  lastCheckedAt: string | null;
  lastSeenAt: string;
  /** Times checked, and how many of those were strong evidence. */
  checks: number;
  strongChecks: number;
  /** The last check was wrong and the reader had said they were sure. */
  misconception: boolean;
}

const stateOf = (events: readonly LedgerEvent[], now: Date): Pick<LedgerItem, "state" | "why" | "recall" | "misconception"> => {
  const checks = events.filter((event) => event.outcome !== null);
  const last = checks.at(-1);
  if (!last) return { state: "untested", why: "Met, never checked", recall: null, misconception: false };
  /* A hinted right answer builds no memory; a hinted miss is still a miss. */
  const schedule = replaySchedule(
    checks.flatMap((event) => {
      const correct = event.outcome! >= PASS;
      return correct && evidenceStrength(event) === "weak" ? [] : [{ at: event.at, correct }];
    }),
  );
  const recall = schedule && recallAt(schedule, now);
  const shaky = (why: string, misconception = false) => ({ state: "shaky" as const, why, recall, misconception });
  if (last.outcome! < PASS) {
    const sure = last.confidence !== null && last.confidence >= SURE;
    return shaky(sure ? "Missed last time, and sure of it" : "Missed last time", sure);
  }
  const lastMiss = checks.findLast((event) => event.outcome! < PASS);
  const proven = checks.some((event) => event.outcome! >= PASS && evidenceStrength(event) === "strong" && (!lastMiss || event.at > lastMiss.at));
  if (!proven) return shaky(checks.every((event) => evidenceStrength(event) === "weak") ? "Only right with help so far" : "Right, but not yet after a day away");
  if (recall === null || recall < HELD_RECALL) {
    const days = Math.round((now.getTime() - Date.parse(last.at)) / DAY_MS);
    return shaky(`Not checked for ${days} ${days === 1 ? "day" : "days"}`);
  }
  return { state: "held", why: "Recalled after a day or more away", recall, misconception: false };
};

/** Each item the events are about, with where it stands now. Only strong evidence makes one held, and held fades. */
export const ledgerItems = (events: readonly LedgerEvent[], now: Date): LedgerItem[] => {
  const groups = new Map<string, LedgerEvent[]>();
  for (const event of [...events].sort((a, b) => a.at.localeCompare(b.at))) groups.set(itemKey(event), [...(groups.get(itemKey(event)) ?? []), event]);
  return [...groups.values()].map((group) => {
    const checks = group.filter((event) => event.outcome !== null);
    /* A check names the item best: a card's fact or a quiz question, over the line that was highlighted. */
    const named = checks.at(-1) ?? group.at(-1)!;
    return {
      bookId: named.bookId,
      item: named.item,
      topic: named.topic,
      chapter: named.chapter ?? group.findLast((event) => event.chapter)?.chapter ?? null,
      anchor: named.anchor ?? group.findLast((event) => event.anchor)?.anchor ?? null,
      ...stateOf(group, now),
      lastOutcome: checks.at(-1)?.outcome ?? null,
      lastCheckedAt: checks.at(-1)?.at ?? null,
      lastSeenAt: group.at(-1)!.at,
      checks: checks.length,
      strongChecks: checks.filter((event) => evidenceStrength(event) === "strong").length,
    };
  });
};

/** Lower comes first: a confident miss, a miss, then what has faded most, then what was never checked, oldest first. */
const weakness = (item: LedgerItem): [number, number] => {
  if (item.state === "untested") return [3, Date.parse(item.lastSeenAt)];
  if (item.misconception) return [0, 0];
  if (item.lastOutcome !== null && item.lastOutcome < PASS) return [1, -Date.parse(item.lastCheckedAt!)];
  return [2, item.recall ?? 0];
};

/** The items most worth going back to, weakest first. Held items are left out. */
export const weakest = (items: readonly LedgerItem[], limit: number): LedgerItem[] =>
  items
    .filter((item) => item.state !== "held")
    .map((item) => ({ item, rank: weakness(item) }))
    .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1])
    .slice(0, limit)
    .map(({ item }) => item);

export interface ChapterCounts {
  chapter: string | null;
  held: number;
  shaky: number;
  untested: number;
}

/** How many items of each chapter are held, shaky and untested, in reading order where the items say where they are. */
export const chapterCounts = (items: readonly LedgerItem[]): ChapterCounts[] => {
  const chapters = new Map<string | null, { counts: ChapterCounts; first: Anchor | null }>();
  for (const item of items) {
    const entry = chapters.get(item.chapter) ?? { counts: { chapter: item.chapter, held: 0, shaky: 0, untested: 0 }, first: null };
    entry.counts[item.state]++;
    if (item.anchor && (!entry.first || compareAnchors(item.anchor, entry.first) < 0)) entry.first = item.anchor;
    chapters.set(item.chapter, entry);
  }
  return [...chapters.values()]
    .sort((a, b) => (a.first && b.first ? compareAnchors(a.first, b.first) : Number(!a.first) - Number(!b.first)))
    .map((entry) => entry.counts);
};

export const totals = (counts: readonly ChapterCounts[]): Omit<ChapterCounts, "chapter"> =>
  counts.reduce((sum, entry) => ({ held: sum.held + entry.held, shaky: sum.shaky + entry.shaky, untested: sum.untested + entry.untested }), { held: 0, shaky: 0, untested: 0 });
