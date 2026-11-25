import type { CardSet, Rating, ReviewRecord, Stance } from "./types";

/** The longest thinking line kept, in characters. */
export const MAX_THINKING = 500;

/** Nothing said: the rail untouched and the line empty. A first-class answer, not a missing one. */
export const SKIPPED: Stance = { confidence: null, thinking: null };

/** A confidence the reader could have set: a whole number from 0 to 100. */
export const isConfidence = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100;

/** At or above this, the reader said they knew it. */
export const SURE = 70;
/** Below this, a right answer was closer to a guess. */
export const UNSURE = 40;

/**
 * What a right or wrong answer means once its confidence is known:
 * - held: right, and sure of it.
 * - shaky: right, half sure.
 * - lucky: right, but close to a guess.
 * - misconception: wrong, and sure of it. The strongest signal there is: a belief that is held and false.
 * - gap: wrong, and the reader knew they didn't know.
 */
export type Signal = "held" | "shaky" | "lucky" | "misconception" | "gap";

export const SIGNAL_LABELS: Record<Signal, string> = {
  held: "Held",
  shaky: "Unsure",
  lucky: "Lucky guess",
  misconception: "Confidently wrong",
  gap: "Known gap",
};

/** The signal in one answer, or null when the reader skipped the rail. */
export const signalOf = (correct: boolean, confidence: number | null): Signal | null => {
  if (confidence === null) return null;
  if (!correct) return confidence >= SURE ? "misconception" : "gap";
  if (confidence >= SURE) return "held";
  return confidence < UNSURE ? "lucky" : "shaky";
};

/** A card rating counts as right unless it is Again. */
export const ratedRight = (rating: Rating) => rating !== "again";

export const recordSignal = (record: Pick<ReviewRecord, "rating" | "confidence">): Signal | null => signalOf(ratedRight(record.rating), record.confidence);

/** The newest record for a cue, if it was ever rated. */
export const lastRecord = (set: CardSet, cueId: string): ReviewRecord | null => {
  const history = set.history ?? [];
  for (let i = history.length - 1; i >= 0; i--) if (history[i].cueId === cueId) return history[i];
  return null;
};

/** How many times a cue drew a confident wrong answer. */
export const misconceptions = (set: CardSet, cueId: string): number =>
  (set.history ?? []).filter((record) => record.cueId === cueId && recordSignal(record) === "misconception").length;

/** A cue that keeps drawing a confident wrong answer is a bad cue, not a bad reader: twice is enough to say so. */
export const MISLEADING_AFTER = 2;

export const isMisleading = (set: CardSet, cueId: string): boolean => misconceptions(set, cueId) >= MISLEADING_AFTER;

/** A stance as the reader gave it, cleaned: the line trimmed and capped, empty text and an unset rail stored as null. */
export const cleanStance = (confidence: number | null, thinking: string | null): Stance => {
  const line = thinking?.replace(/\s+/g, " ").trim().slice(0, MAX_THINKING) ?? "";
  return { confidence: confidence !== null && isConfidence(confidence) ? confidence : null, thinking: line || null };
};
