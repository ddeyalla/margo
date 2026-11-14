/** What the card prompt returned, checked. */
export type CardReply = { fact: string; cards: { question: string; answer: string }[] } | { fact: null; reason: string };

const MAX_CARDS = 3;
const MAX_FIELD = 2_000;

/** The first complete JSON object in the text, skipping any fence or notes around it. */
const firstObject = (text: string): string | null => {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
};

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
  const { fact, reason, cards } = value as Record<string, unknown>;
  if (fact === null) return { fact: null, reason: field(reason) ?? "The passage holds no fact worth a card." };
  const statement = field(fact);
  if (!statement) return '"fact" must be a sentence, or null.';
  if (!Array.isArray(cards)) return '"cards" must list one to three cards when "fact" is set.';
  /* The prompt tells the model to return no cards when the reader's cards already cover the passage: nothing new, not a bad reply. */
  if (cards.length === 0) return { fact: null, reason: field(reason) ?? "The cards you already have cover this passage." };
  const checked: { question: string; answer: string }[] = [];
  for (const card of cards) {
    const question = field(card?.question);
    const answer = field(card?.answer);
    if (!question || !answer) return 'Every card needs a non-empty "question" and "answer".';
    if (!checked.some((c) => sameQuestion(c.question, question))) checked.push({ question, answer });
  }
  return { fact: statement, cards: checked.slice(0, MAX_CARDS) };
};
