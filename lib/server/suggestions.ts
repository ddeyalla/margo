import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  emptySuggestions,
  withDecision,
  withProposed,
  type CardSuggestion,
  type Decision,
  type PlanSuggestion,
  type Suggestion,
  type SuggestionStatus,
  type SuggestionsFile,
} from "@/lib/shared/suggestions";
import { studyDay } from "@/lib/shared/schedule";
import type { LibraryBook } from "@/lib/shared/types";
import { verifyCards } from "./cards/generate";
import { parseCardFields } from "./cards/reply";
import { storeCards } from "./cards/store";
import type { Checker } from "./check/provider";
import { getConfig } from "./config";
import { findBook, recentLibrary } from "./library";
import { readBookState, readJson, serializedFile, updateJson } from "./store";
import { ToolError } from "./tools/schema";
import { MAX_QUOTE, parseAnchor, shortText } from "./validate";

/** The suggestions inbox: every change an agent proposed, waiting or decided. One file for the whole library. */
export const suggestionsFile = (dataDir = getConfig().dataDir) => path.join(/*turbopackIgnore: true*/ dataDir, "suggestions.json");

export const readSuggestions = async (dataDir = getConfig().dataDir): Promise<SuggestionsFile> => ({
  ...emptySuggestions(),
  ...(await readJson<Partial<SuggestionsFile>>(suggestionsFile(dataDir))),
});

const updateSuggestions = (change: (current: SuggestionsFile) => SuggestionsFile, dataDir: string) =>
  updateJson(suggestionsFile(dataDir), emptySuggestions, (current) => change({ ...emptySuggestions(), ...current }));

/** Suggestions with the given status, or all of them, oldest first. */
export const listSuggestions = async (status?: SuggestionStatus, dataDir = getConfig().dataDir): Promise<Suggestion[]> =>
  (await readSuggestions(dataDir)).suggestions.filter((entry) => !status || entry.status === status);

/**
 * Adds a proposed review card for a passage of `book` to the inbox. `body` is
 * `{ anchor, quote, chapterTitle?, fact, cards: [{ question, answer }] }`. Throws `ToolError` for a proposal that
 * can't be kept as sent.
 *
 * Every card is checked against the quote here, when it is proposed, so the agent waits on the model and the
 * reader never does: what they see is already checked, and Add stays instant. Cards that fail are kept on the
 * suggestion as left out, with why. When none pass, the suggestion is stored as "failed" and never waits in the
 * inbox. Nothing reaches the book until the reader accepts.
 */
export const proposeCard = async (
  book: LibraryBook,
  body: Record<string, unknown>,
  proposer: string,
  checker: Checker,
  now = new Date(),
  dataDir = getConfig().dataDir,
): Promise<CardSuggestion> => {
  const anchor = parseAnchor(body.anchor, book.format);
  const quote = shortText(body.quote, MAX_QUOTE);
  if (!anchor || !quote) throw new ToolError(`The passage needs its "quote" and an "anchor" of the kind "${book.format}", copied from search_library or get_book_text.`);
  const checked = parseCardFields({ fact: body.fact, cards: body.cards });
  if (typeof checked === "string") throw new ToolError(checked);
  if (checked.fact === null) throw new ToolError('A card needs its "fact" and one to three "cards".');
  const chapterTitle = shortText(body.chapterTitle, 500);
  const { kept, dropped } = await verifyCards(checker, { quote, before: "", after: "", chapterTitle }, checked.cards, new AbortController().signal, now);
  const failed = dropped.map(({ question, reason }) => ({ question, answer: checked.cards.find((card) => card.question === question)?.answer ?? "", reason }));
  const suggestion: CardSuggestion = {
    id: randomUUID(),
    kind: "card",
    target: { bookId: book.id, anchor },
    payload: { quote, chapterTitle, fact: checked.fact, cards: kept, ...(failed.length ? { failed } : {}) },
    proposer,
    createdAt: now.toISOString(),
    status: kept.length ? "pending" : "failed",
    decidedAt: kept.length ? null : now.toISOString(),
  };
  let full = false;
  await updateSuggestions((current) => {
    const next = withProposed(current, suggestion);
    full = next === null;
    return next ?? current;
  }, dataDir);
  if (full) throw new ToolError("The reader's inbox is full of suggestions they haven't decided on yet. Propose more once they have.");
  return suggestion;
};

/**
 * Adds a prepared session plan to the inbox. There is one plan a day: a plan still waiting for that day is
 * replaced, and plans waiting for days already gone are dropped, so preparing again never stacks plans or fills the
 * inbox. Those are unread advice, never the reader's content or a decision of theirs. The inbox's cap applies as it
 * does to every proposal, counted after they go.
 */
export const proposePlan = async (
  plan: PlanSuggestion["payload"],
  proposer: string,
  now = new Date(),
  dataDir = getConfig().dataDir,
): Promise<PlanSuggestion> => {
  const suggestion: PlanSuggestion = {
    id: randomUUID(),
    kind: "plan",
    target: { bookId: null },
    payload: plan,
    proposer,
    createdAt: now.toISOString(),
    status: "pending",
    decidedAt: null,
  };
  let full = false;
  await updateSuggestions((current) => {
    const today = studyDay(now);
    const rest = { suggestions: current.suggestions.filter((entry) => !(entry.kind === "plan" && entry.status === "pending" && (entry.payload.forDay === plan.forDay || entry.payload.forDay < today))) };
    const next = withProposed(rest, suggestion);
    full = next === null;
    return next ?? current;
  }, dataDir);
  if (full) throw new ToolError("The reader's inbox is full of suggestions they haven't decided on yet. Propose more once they have.");
  return suggestion;
};

/** Why a suggestion can't be decided as asked, worded for the reader. */
export class SuggestionError extends Error {
  override name = "SuggestionError";
}

/* Makes the change a suggestion proposes. Each kind goes through the code the app uses for that change. */
const apply = async (suggestion: Suggestion, now: Date, dataDir: string, notesDir: string | null): Promise<void> => {
  switch (suggestion.kind) {
    /* A prepared plan is advice. Accepting it only says the reader has seen it; it changes nothing in any book. */
    case "plan":
      return;
    case "card": {
      const found = await findBook(suggestion.target.bookId, undefined, dataDir);
      if (!found) throw new SuggestionError("That book is no longer in the library, so the card has nowhere to go. Reject it instead.");
      /* Only checked cards are stored. A suggestion from before proposals were checked has none. */
      const { quote, chapterTitle, fact } = suggestion.payload;
      const cards = suggestion.payload.cards.filter((card) => card.verifiedAt);
      if (!cards.length) throw new SuggestionError("These cards were proposed before cards were checked against the book, so they can't be added. Reject it, and have the agent propose it again.");
      await storeCards(found.book, { anchor: suggestion.target.anchor, quote, chapterTitle, fact, cards }, { dataDir, notesDir }, now);
    }
  }
};

/**
 * Accepts or rejects a waiting suggestion. Decisions are made one at a time, in every process, so an accept and
 * a reject of the same suggestion can't both go through. Accepting makes its change first and marks it after,
 * and the change is one that is safe to make twice, so a crash in between never doubles it or loses it.
 */
export const decideSuggestion = async (
  id: string,
  decision: Decision,
  now = new Date(),
  { dataDir, notesDir }: { dataDir: string; notesDir: string | null } = getConfig(),
): Promise<Suggestion> =>
  /* A key of its own beside the inbox file: the inbox's own lock is taken inside, when the decision is written. */
  serializedFile(`${suggestionsFile(dataDir)}.deciding`, async () => {
    const suggestion = (await readSuggestions(dataDir)).suggestions.find((entry) => entry.id === id);
    if (!suggestion) throw new SuggestionError("That suggestion is gone.");
    if (suggestion.status !== "pending") throw new SuggestionError(`That suggestion was already ${suggestion.status}.`);
    if (decision === "accept") await apply(suggestion, now, dataDir, notesDir);
    const status = decision === "accept" ? "accepted" : "rejected";
    const saved = await updateSuggestions((current) => withDecision(current, id, status, now), dataDir);
    return saved.suggestions.find((entry) => entry.id === id) ?? { ...suggestion, status, decidedAt: now.toISOString() };
  });

/** A waiting suggestion with its book's title, as Today shows it. The title is null for a book that left the library. */
export type PendingSuggestion = Suggestion & { bookTitle: string | null };

export const pendingSuggestions = async (dataDir = getConfig().dataDir): Promise<PendingSuggestion[]> => {
  /* A prepared plan comes before cards, so the reader sees it first however many cards were added after it. */
  const pending = (await listSuggestions("pending", dataDir)).sort((a, b) => Number(b.kind === "plan") - Number(a.kind === "plan"));
  if (!pending.length) return [];
  /* One look at the library for all of them, so suggestions for books that left don't each scan it again. */
  const books = new Map((await recentLibrary(undefined, dataDir)).books.map((book) => [book.id, book]));
  return Promise.all(
    pending.map(async (suggestion) => {
      const book = suggestion.target.bookId ? books.get(suggestion.target.bookId) : undefined;
      const state = book ? await readBookState(book.id, dataDir).catch(() => null) : null;
      return { ...suggestion, bookTitle: book ? state?.meta?.title || book.fileTitle : null };
    }),
  );
};
