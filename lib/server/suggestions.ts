import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  emptySuggestions,
  withDecision,
  withProposed,
  type CardSuggestion,
  type Decision,
  type Suggestion,
  type SuggestionStatus,
  type SuggestionsFile,
} from "@/lib/shared/suggestions";
import type { LibraryBook } from "@/lib/shared/types";
import { parseCardFields } from "./cards/reply";
import { storeCards } from "./cards/store";
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
 * `{ anchor, quote, chapterTitle?, fact, cards: [{ question, answer }] }`. Nothing reaches the book until the
 * reader accepts it. Throws `ToolError` for a proposal that can't be kept as sent.
 */
export const proposeCard = async (book: LibraryBook, body: Record<string, unknown>, proposer: string, now = new Date(), dataDir = getConfig().dataDir): Promise<CardSuggestion> => {
  const anchor = parseAnchor(body.anchor, book.format);
  const quote = shortText(body.quote, MAX_QUOTE);
  if (!anchor || !quote) throw new ToolError(`The passage needs its "quote" and an "anchor" of the kind "${book.format}", copied from search_library or get_book_text.`);
  const checked = parseCardFields({ fact: body.fact, cards: body.cards });
  if (typeof checked === "string") throw new ToolError(checked);
  if (checked.fact === null) throw new ToolError('A card needs its "fact" and one to three "cards".');
  const suggestion: CardSuggestion = {
    id: randomUUID(),
    kind: "card",
    target: { bookId: book.id, anchor },
    payload: { quote, chapterTitle: shortText(body.chapterTitle, 500), fact: checked.fact, cards: checked.cards },
    proposer,
    createdAt: now.toISOString(),
    status: "pending",
    decidedAt: null,
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

/** Why a suggestion can't be decided as asked, worded for the reader. */
export class SuggestionError extends Error {
  override name = "SuggestionError";
}

/* Makes the change a suggestion proposes. Each kind goes through the code the app uses for that change. */
const apply = async (suggestion: Suggestion, now: Date, dataDir: string, notesDir: string | null): Promise<void> => {
  switch (suggestion.kind) {
    case "card": {
      const found = await findBook(suggestion.target.bookId, undefined, dataDir);
      if (!found) throw new SuggestionError("That book is no longer in the library, so the card has nowhere to go. Reject it instead.");
      await storeCards(found.book, { anchor: suggestion.target.anchor, ...suggestion.payload }, { dataDir, notesDir }, now);
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
  const pending = await listSuggestions("pending", dataDir);
  if (!pending.length) return [];
  /* One look at the library for all of them, so suggestions for books that left don't each scan it again. */
  const books = new Map((await recentLibrary(undefined, dataDir)).books.map((book) => [book.id, book]));
  return Promise.all(
    pending.map(async (suggestion) => {
      const book = books.get(suggestion.target.bookId);
      const state = book ? await readBookState(book.id, dataDir).catch(() => null) : null;
      return { ...suggestion, bookTitle: book ? state?.meta?.title || book.fileTitle : null };
    }),
  );
};
