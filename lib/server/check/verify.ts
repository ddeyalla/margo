import { structured } from "../tutor/structured";
import type { Provider } from "../tutor/types";
import { inPassage, replyObject, textField } from "./reply";

/** A written question with the answer stored for it and the text it was written from. */
export interface CheckItem {
  question: string;
  expected: string;
  passage: string;
}

/** What checking an item against its passage found. Only an item with all three true is fit to save. */
export interface Verification {
  /** The passage alone holds an answer to the question. */
  answerable: boolean;
  /** The answer written from the passage alone says what the stored answer says. */
  matches: boolean;
  /** The passage backs everything the stored answer claims. */
  supported: boolean;
  /** One sentence on what was found: what is missing or differs when the item fails. */
  reason: string;
  /** The answer written from the passage alone, or null when there was none. */
  answer: string | null;
}

/** How many items a generator checks at once. Each is a CLI process or an API call. */
export const CHECKS_AT_ONCE = 4;

export const isVerified = (verification: Verification): boolean => verification.answerable && verification.matches && verification.supported;

export const ANSWER_SYSTEM = `You answer one question from a passage of a book, and from nothing else. You get the passage and the question.

- Use only what the passage states or directly implies. What you know from elsewhere doesn't count, even when it is true.
- Say the question can't be answered when the passage doesn't hold the answer, when the question rests on something the passage doesn't say or contradicts, or when it is too vague for the passage to settle on one answer.
- The answer is short: the point first, in one to three sentences.
- "evidence" is the one stretch of the passage the answer rests on most, copied word for word, at most about 40 words, with nothing left out of its middle.

Reply with exactly one JSON object and nothing else:

{"answerable": true, "answer": "...", "evidence": "..."}

or, when the passage can't answer it:

{"answerable": false, "reason": "what is missing, in one sentence"}`;

export const COMPARE_SYSTEM = `You check the answer stored for a study question. You get a passage from a book, the question, the stored answer, and a second answer that someone wrote from the passage alone without seeing the stored one.

Decide two things:
- "matches": do the two answers say the same thing in substance? Wording, length and extra detail don't matter. They don't match when they name different things, numbers, causes or directions, or when one contradicts the other.
- "supported": does the passage state or directly imply everything the stored answer claims? A stored answer that adds a claim the passage doesn't make, makes a claim stronger or more general than the passage does, or gets a detail wrong is not supported, even when the claim is true elsewhere. Leaving detail out is fine.

"reason" is one short sentence. When either is false, name what differs or what the passage doesn't say.

Reply with exactly one JSON object and nothing else:

{"matches": true, "supported": true, "reason": "..."}`;

type BlindAnswer = { answerable: true; answer: string; evidence: string } | { answerable: false; reason: string };

/** Reads the first prompt's reply. An answer whose evidence isn't in the passage word for word goes back for repair. */
export const parseAnswerReply = (text: string, passage: string): BlindAnswer | string => {
  const reply = replyObject(text);
  if (typeof reply === "string") return reply;
  if (reply.answerable === false) return { answerable: false, reason: textField(reply.reason, 500) ?? "The passage doesn't hold the answer." };
  if (reply.answerable !== true) return '"answerable" must be true or false.';
  const answer = textField(reply.answer);
  const evidence = textField(reply.evidence);
  if (!answer || !evidence) return 'An answerable question needs a non-empty "answer" and "evidence".';
  if (!inPassage(passage, evidence)) return '"evidence" must be copied word for word from the passage, as one stretch. If no stretch of the passage gives the answer, reply that it is not answerable.';
  return { answerable: true, answer, evidence };
};

export const parseCompareReply = (text: string): { matches: boolean; supported: boolean; reason: string } | string => {
  const reply = replyObject(text);
  if (typeof reply === "string") return reply;
  if (typeof reply.matches !== "boolean" || typeof reply.supported !== "boolean") return '"matches" and "supported" must each be true or false.';
  const reason = textField(reply.reason, 500);
  if (!reason) return '"reason" must be one short sentence.';
  return { matches: reply.matches, supported: reply.supported, reason };
};

const tagged = (name: string, text: string) => `<${name}>\n${text}\n</${name}>`;

/** What the first call sees: the passage and the question. The stored answer is deliberately not in it. */
export const answerRequest = ({ question, passage }: Pick<CheckItem, "question" | "passage">): string =>
  [tagged("passage", passage), "", tagged("question", question), "", "Answer the question from the passage alone."].join("\n");

export const compareRequest = ({ question, expected, passage }: CheckItem, answer: string): string =>
  [
    tagged("passage", passage),
    "",
    tagged("question", question),
    "",
    tagged("stored_answer", expected),
    "",
    tagged("answer_from_passage", answer),
    "",
    "Check the stored answer.",
  ].join("\n");

/**
 * Checks a written question against the text it came from, in two calls that share nothing. The first is a new
 * conversation that sees the passage and the question but not the stored answer, and answers from the passage
 * alone. The second compares that answer with the stored one and says whether the passage backs the stored one.
 * A question the passage can't answer stops after the first call.
 */
export const verifyItem = async (provider: Provider, item: CheckItem, model: string | null, signal: AbortSignal): Promise<Verification> => {
  const blind = await structured(
    provider,
    { system: ANSWER_SYSTEM, request: answerRequest(item), parse: (reply) => parseAnswerReply(reply, item.passage), failure: "The check's answer couldn't be read." },
    model,
    signal,
  );
  if (!blind.answerable) return { answerable: false, matches: false, supported: false, reason: blind.reason, answer: null };
  const compared = await structured(
    provider,
    { system: COMPARE_SYSTEM, request: compareRequest(item, blind.answer), parse: parseCompareReply, failure: "The check's comparison couldn't be read." },
    model,
    signal,
  );
  return { answerable: true, ...compared, answer: blind.answer };
};

/**
 * Checks an item for a generator that will drop it unless it passes. A check that couldn't be run counts as not
 * passed, with why, so one bad reply costs one item and not the whole batch.
 */
export const checked = (provider: Provider, item: CheckItem, model: string | null, signal: AbortSignal): Promise<Verification> =>
  verifyItem(provider, item, model, signal).catch((error: unknown): Verification => {
    if (signal.aborted) throw error;
    return { answerable: false, matches: false, supported: false, reason: `The check couldn't be run: ${error instanceof Error ? error.message : "unknown error"}`, answer: null };
  });
