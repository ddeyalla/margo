import { readFileSync } from "node:fs";
import path from "node:path";
import { lastRecord, misconceptions } from "@/lib/shared/confidence";
import type { NewCard } from "@/lib/shared/cards";
import type { CardSet } from "@/lib/shared/types";
import type { Checker } from "../check/provider";
import { checked, CHECKS_AT_ONCE, isVerified } from "../check/verify";
import type { BookLabel } from "../tutor/prompt";
import { pooled, structured } from "../tutor/structured";
import type { Provider } from "../tutor/types";
import { parseCardReply, type CardReply } from "./reply";

/** The passage cards are made from, already validated and trimmed. */
export interface CardSource {
  quote: string;
  before: string;
  after: string;
  chapterTitle: string | null;
}

/* Read once per server start. Next runs the server from the project folder. */
let system: string | null = null;
const cardSystem = () => (system ??= readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), "lib/server/cards/prompt.md"), "utf8"));

/**
 * The cues the passage already has, one per line. A cue that drew confident wrong answers says so, with what the
 * reader was thinking the last time: that is evidence the question misleads, not that the reader is careless.
 */
const existingCues = (set: CardSet): string =>
  set.cues
    .map((cue) => {
      const wrong = misconceptions(set, cue.id);
      if (!wrong) return `- ${cue.question}`;
      const thinking = lastRecord(set, cue.id)?.thinking;
      return `- ${cue.question}\n  (Answered wrong while sure ${wrong === 1 ? "once" : `${wrong} times`}.${thinking ? ` Last time the reader was thinking: "${thinking}"` : ""})`;
    })
    .join("\n");

export const cardRequest = (book: BookLabel, source: CardSource, existing: CardSet | null): string => {
  const misled = existing?.cues.some((cue) => misconceptions(existing, cue.id) > 0) ?? false;
  return [
    `Book: ${book.title}${book.author ? `, by ${book.author}` : ""}`,
    source.chapterTitle ? `Where: ${source.chapterTitle}` : null,
    "",
    "Text just before the selection:",
    `<before>\n${source.before || "(start of the section)"}\n</before>`,
    "",
    "The selected passage:",
    `<selection>\n${source.quote}\n</selection>`,
    "",
    "Text just after the selection:",
    `<after>\n${source.after || "(end of the section)"}\n</after>`,
    "",
    existing?.cues.length
      ? `The reader already has these cards on this passage. Add only cards that start somewhere new, for the same fact. If these already cover it, return no cards.\n${existingCues(existing)}\n\n${
          misled
            ? "A card the reader answered wrong while sure is a bad cue, not a bad reader: its wording leads to a wrong answer that feels right. Write one card that asks for the same fact from somewhere that can't be misread that way, even if the others already cover the fact.\n\n"
            : ""
        }Make flashcards for this passage.`
      : "Make flashcards for this passage.",
  ]
    .filter((line) => line !== null)
    .join("\n");
};

/** Asks the tutor for cards. A reply that can't be read goes back once with the reason. */
export const generateCards = (provider: Provider, request: string, model: string | null, signal: AbortSignal): Promise<CardReply> =>
  structured(provider, { system: cardSystem(), request, parse: parseCardReply, failure: "The tutor's cards couldn't be read." }, model, signal);

/** The text a card's answer may rest on: the selection and what the prompt was shown around it. */
export const cardPassage = (source: CardSource): string => [source.before, source.quote, source.after].filter(Boolean).join("\n");

/**
 * Checks each new card against its passage before it is stored. A card that fails is dropped with why; a card
 * that passes carries the time it was checked.
 */
export const verifyCards = async (
  { provider, model }: Checker,
  source: CardSource,
  cards: readonly Omit<NewCard, "verifiedAt">[],
  signal: AbortSignal,
  now = new Date(),
): Promise<{ kept: NewCard[]; dropped: { question: string; reason: string }[] }> => {
  const passage = cardPassage(source);
  const results = await pooled(cards, CHECKS_AT_ONCE, (card) => checked(provider, { question: card.question, expected: card.answer, passage }, model, signal));
  const verifiedAt = now.toISOString();
  return {
    kept: cards.filter((_, i) => isVerified(results[i])).map((card) => ({ ...card, verifiedAt })),
    dropped: cards.flatMap((card, i) => (isVerified(results[i]) ? [] : [{ question: card.question, reason: results[i].reason }])),
  };
};
