import type { NewCard } from "@/lib/shared/cards";
import { firstObject } from "@/lib/shared/json";
import { ANSWER_TYPES, MAX_CHOICES, MIN_CHOICES } from "@/lib/shared/types";

/** What the card prompt returned, checked. */
export type CardReply = { fact: string; cards: Pick<NewCard, "question" | "answer" | "type" | "choices">[] } | { fact: null; reason: string };

const MAX_CARDS = 3;
const MAX_FIELD = 2_000;

const field = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_FIELD ? trimmed : null;
};

const sameQuestion = (a: string, b: string) => a.toLowerCase().replace(/\W+/g, " ").trim() === b.toLowerCase().replace(/\W+/g, " ").trim();

/** Reads the model's reply. Returns a message to send back for repair when it can't. */
export const parseCardReply = (text: string): CardReply | string => {
  const json = firstObject(text);
  if (!json) return "The reply had no JSON object.";
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    return `The JSON did not parse: ${error instanceof Error ? error.message : "unknown error"}.`;
  }
  if (!value || typeof value !== "object") return "The reply was not a JSON object.";
  return parseCardFields(value as Record<string, unknown>);
};

/** A card's answer type and, for a choice, its options. A card with no type is a flip; a choice needs two to six distinct options, the answer one of them. */
const typedCard = (card: Record<string, unknown>, question: string, answer: string): { question: string; answer: string; type?: NewCard["type"]; choices?: string[] } | string => {
  const type = card.type ?? "flip";
  if (!ANSWER_TYPES.includes(type as never)) return `"type" is one of ${ANSWER_TYPES.map((name) => `"${name}"`).join(", ")}.`;
  if (type !== "choice") return { question, answer, ...(type === "free" ? { type: "free" as const } : {}) };
  const options = Array.isArray(card.choices) ? card.choices.map(field) : [];
  const choices = [...new Set(options.filter((option): option is string => !!option))];
  if (choices.length !== options.length || choices.length < MIN_CHOICES || choices.length > MAX_CHOICES) return `A "choice" card needs ${MIN_CHOICES} to ${MAX_CHOICES} different, non-empty "choices".`;
  if (!choices.includes(answer)) return 'A "choice" card\'s "answer" must be one of its "choices", word for word.';
  return { question, answer, type: "choice", choices };
};

/** Checks a fact and its cards, whoever wrote them: the tutor's reply, or an agent's proposal. */
export const parseCardFields = ({ fact, reason, cards }: Record<string, unknown>): CardReply | string => {
  if (fact === null) return { fact: null, reason: field(reason) ?? "The passage holds no fact worth a card." };
  const statement = field(fact);
  if (!statement) return '"fact" must be a sentence, or null.';
  if (!Array.isArray(cards)) return '"cards" must list one to three cards when "fact" is set.';
  /* The prompt tells the model to return no cards when the reader's cards already cover the passage: nothing new, not a bad reply. */
  if (cards.length === 0) return { fact: null, reason: field(reason) ?? "The cards you already have cover this passage." };
  const checked: CardReply extends infer R ? (R extends { cards: infer C } ? C : never) : never = [];
  for (const card of cards) {
    const question = field(card?.question);
    const answer = field(card?.answer);
    if (!question || !answer) return 'Every card needs a non-empty "question" and "answer".';
    const typed = typedCard(card, question, answer);
    if (typeof typed === "string") return typed;
    if (!checked.some((c) => sameQuestion(c.question, question))) checked.push(typed);
  }
  return { fact: statement, cards: checked.slice(0, MAX_CARDS) };
};
