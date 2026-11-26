import { firstObject } from "@/lib/shared/json";

/* Reading what the checking prompts reply with. Each parser gives the value, or a sentence to send back for repair. */

/** The reply's JSON object, or a sentence saying why there isn't one. */
export const replyObject = (text: string): Record<string, unknown> | string => {
  const json = firstObject(text);
  if (!json) return "The reply had no JSON object.";
  try {
    const value: unknown = JSON.parse(json);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : "The reply was not a JSON object.";
  } catch (error) {
    return `The JSON did not parse: ${error instanceof Error ? error.message : "unknown error"}.`;
  }
};

export const textField = (value: unknown, max = 2_000): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
};

/* Letters, digits and their marks only, so a quote still matches when the model straightens a curly quote, joins a
   line break, drops the end marks or writes "1000" for "1,000". Spaces go too: scripts that don't use them need no
   word edges, and a quote that starts inside a word is still the passage's own text. */
const plain = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, "");

/** Whether `quote` is a stretch of `passage`, word for word. A model that answers from what it knows can't produce one. */
export const inPassage = (passage: string, quote: string): boolean => {
  const wanted = plain(quote);
  return wanted.length > 0 && plain(passage).includes(wanted);
};
