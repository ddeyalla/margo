import type { Anchor, BookId } from "./types";

/*
 * A change an agent proposes and the reader decides on. Agents may run while the app is closed, so nothing
 * they propose touches the reader's content until it is accepted here. Every suggestion has the same frame
 * (what kind, what it is aimed at, the change itself, who proposed it, when, and where it stands), so a new
 * kind is a new member of the union and one more case where suggestions are applied. A whiteboard edit would be
 * `{ kind: "board", target: { bookId, boardId }, payload: { ops } }`; today those still live on the board itself.
 */

export type SuggestionStatus = "pending" | "accepted" | "rejected";

interface SuggestionFrame {
  id: string;
  /** The agent that proposed it, by the name its client gave. */
  proposer: string;
  createdAt: string;
  status: SuggestionStatus;
  /** When the reader accepted or rejected it, or null while it waits. */
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
    cards: { question: string; answer: string }[];
  };
}

export type Suggestion = CardSuggestion;
export type SuggestionKind = Suggestion["kind"];

export interface SuggestionsFile {
  suggestions: Suggestion[];
}

export const emptySuggestions = (): SuggestionsFile => ({ suggestions: [] });

export const SUGGESTION_STATUSES: readonly SuggestionStatus[] = ["pending", "accepted", "rejected"];

export type Decision = "accept" | "reject";
export const isDecision = (value: unknown): value is Decision => value === "accept" || value === "reject";

/** The most suggestions that may wait at once. An agent that proposes more is told to wait for the reader. */
export const MAX_PENDING = 100;
/** Decided suggestions are kept as a record, the newest this many. */
export const MAX_DECIDED = 200;

/** The file with `added` waiting at the end, or null when the inbox is full. */
export const withProposed = (file: SuggestionsFile, added: Suggestion): SuggestionsFile | null =>
  file.suggestions.filter((entry) => entry.status === "pending").length >= MAX_PENDING ? null : { suggestions: [...file.suggestions, added] };

/** The file with one suggestion decided, and only the newest decided ones kept. A suggestion already decided, or gone, changes nothing. */
export const withDecision = (file: SuggestionsFile, id: string, status: Exclude<SuggestionStatus, "pending">, now: Date): SuggestionsFile => {
  if (!file.suggestions.some((entry) => entry.id === id && entry.status === "pending")) return file;
  const all = file.suggestions.map((entry) => (entry.id === id ? { ...entry, status, decidedAt: now.toISOString() } : entry));
  const decided = all.filter((entry) => entry.status !== "pending");
  const dropped = new Set(decided.slice(0, Math.max(0, decided.length - MAX_DECIDED)).map((entry) => entry.id));
  return { suggestions: all.filter((entry) => !dropped.has(entry.id)) };
};
