import type { NewCard } from "./cards";
import type { Anchor, BookId } from "./types";

/*
 * A change an agent proposes and the reader decides on. Agents may run while the app is closed, so nothing
 * they propose touches the reader's content until it is accepted here. Every suggestion has the same frame
 * (what kind, what it is aimed at, the change itself, who proposed it, when, and where it stands), so a new
 * kind is a new member of the union and one more case where suggestions are applied. A whiteboard edit would be
 * `{ kind: "board", target: { bookId, boardId }, payload: { ops } }`; today those still live on the board itself.
 */

/**
 * "pending" waits for the reader, who makes it "accepted" or "rejected". "failed" never reached them: nothing in it
 * passed the check against its passage, and it is kept so the agent that proposed it can see why.
 */
export type SuggestionStatus = "pending" | "accepted" | "rejected" | "failed";

interface SuggestionFrame {
  id: string;
  /** The agent that proposed it, by the name its client gave. */
  proposer: string;
  createdAt: string;
  status: SuggestionStatus;
  /** When the reader accepted or rejected it, or when it failed its check; null while it waits. */
  decidedAt: string | null;
}

/** Review cards for a passage: one fact, and one to three questions that each reach it. */
export interface CardSuggestion extends SuggestionFrame {
  kind: "card";
  target: { bookId: BookId; anchor: Anchor };
  payload: {
    quote: string;
    chapterTitle: string | null;
    fact: string;
    /** The cards the reader can add: each passed the check against the quote when it was proposed, at `verifiedAt`. */
    cards: NewCard[];
    /** Proposed cards that didn't pass, with why. They are shown as left out and are never added. */
    failed?: { question: string; answer: string; reason: string }[];
  };
}

/** One thing in a prepared plan: a passage or topic, in a book, and why it is there. */
export interface PlanItem {
  bookId: BookId;
  bookTitle: string;
  topic: string;
  chapter: string | null;
  anchor: Anchor | null;
  why: string;
}

/** An exercise is tied to a passage and says what the reader is asked to do. */
export type PlanExercise = PlanItem & { anchor: Anchor; prompt: string };

export interface PlanQuestion {
  bookId: BookId;
  bookTitle: string;
  question: string;
  threadId: string | null;
}

/**
 * A prepared session for a day: what to retest, an exercise or two tied to where the reader is, and open questions.
 * It is read-only advice. Accepting it only says the reader has seen it; any cards it wants are suggestions of their own.
 */
export interface PlanSuggestion extends SuggestionFrame {
  kind: "plan";
  /** Plans span books, so there is no one book to aim at. */
  target: { bookId: null };
  payload: { forDay: string; note: string | null; retest: PlanItem[]; exercises: PlanExercise[]; questions: PlanQuestion[] };
}

export type Suggestion = CardSuggestion | PlanSuggestion;
export type SuggestionKind = Suggestion["kind"];

export interface SuggestionsFile {
  suggestions: Suggestion[];
}

export const emptySuggestions = (): SuggestionsFile => ({ suggestions: [] });

export const SUGGESTION_STATUSES: readonly SuggestionStatus[] = ["pending", "accepted", "rejected", "failed"];

export type Decision = "accept" | "reject";
export const isDecision = (value: unknown): value is Decision => value === "accept" || value === "reject";

/** The most suggestions that may wait at once. An agent that proposes more is told to wait for the reader. */
export const MAX_PENDING = 100;
/** Decided suggestions are kept as a record, the newest this many. */
export const MAX_DECIDED = 200;

/** The suggestions with only the newest decided ones kept. Waiting ones all stay. */
const trimmed = (all: Suggestion[]): Suggestion[] => {
  const decided = all.filter((entry) => entry.status !== "pending");
  const dropped = new Set(decided.slice(0, Math.max(0, decided.length - MAX_DECIDED)).map((entry) => entry.id));
  return all.filter((entry) => !dropped.has(entry.id));
};

/** The file with `added` at the end, or null when the inbox is full. One that failed its check waits for nobody, so it always fits. */
export const withProposed = (file: SuggestionsFile, added: Suggestion): SuggestionsFile | null =>
  added.status === "pending" && file.suggestions.filter((entry) => entry.status === "pending").length >= MAX_PENDING
    ? null
    : { suggestions: trimmed([...file.suggestions, added]) };

/** The file with one suggestion decided, and only the newest decided ones kept. A suggestion already decided, or gone, changes nothing. */
export const withDecision = (file: SuggestionsFile, id: string, status: "accepted" | "rejected", now: Date): SuggestionsFile => {
  if (!file.suggestions.some((entry) => entry.id === id && entry.status === "pending")) return file;
  return { suggestions: trimmed(file.suggestions.map((entry) => (entry.id === id ? { ...entry, status, decidedAt: now.toISOString() } : entry))) };
};
