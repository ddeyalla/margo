import { sameAnchor } from "./annotations";
import { applyReview, newSchedule, type Review } from "./schedule";
import type { Anchor, CardSet, Cue } from "./types";

/** Cards the tutor wrote for a passage, ready to store. */
export interface NewCards {
  anchor: Anchor;
  quote: string;
  chapterTitle: string | null;
  fact: string;
  /** `verifiedAt` is when a card was checked against the passage; absent on a card that wasn't. */
  cards: { question: string; answer: string; verifiedAt?: string }[];
}

export type CardChange =
  | { op: "edit-cue"; setId: string; cueId: string; question: string; answer: string }
  | { op: "delete-cue"; setId: string; cueId: string }
  | { op: "delete-set"; setId: string }
  | ({ op: "review"; setId: string } & Review);

const normalized = (question: string) => question.toLowerCase().replace(/\W+/g, " ").trim();

/**
 * Adds new cards. A passage that already has a set gets the new cues added to
 * it, keeping its schedule and history; a question it already asks is skipped.
 * Returns the sets and how many cues were added.
 */
export const addCards = (sets: CardSet[], added: NewCards, now: Date, newId: () => string): { sets: CardSet[]; count: number } => {
  const at = now.toISOString();
  const existing = sets.find((set) => sameAnchor(set.anchor, added.anchor));
  const asked = new Set(existing?.cues.map((cue) => normalized(cue.question)));
  const cues: Cue[] = [];
  for (const card of added.cards) {
    if (asked.has(normalized(card.question))) continue;
    asked.add(normalized(card.question));
    cues.push({ id: newId(), question: card.question, answer: card.answer, createdAt: at, lastRating: null, ...(card.verifiedAt ? { verifiedAt: card.verifiedAt } : {}) });
  }
  if (!cues.length) return { sets, count: 0 };
  if (existing) return { sets: sets.map((set) => (set === existing ? { ...set, cues: [...set.cues, ...cues] } : set)), count: cues.length };
  const set: CardSet = {
    id: newId(),
    anchor: added.anchor,
    quote: added.quote,
    chapterTitle: added.chapterTitle,
    fact: added.fact,
    cues,
    schedule: newSchedule(now),
    learningCueId: null,
    introducedOn: null,
    createdAt: at,
  };
  return { sets: [...sets, set], count: cues.length };
};

/** A cue with the reader's wording. The check was of the old wording, so its mark goes unless nothing changed. */
const editedCue = ({ verifiedAt, ...cue }: Cue, question: string, answer: string): Cue => ({
  ...cue,
  question,
  answer,
  ...(verifiedAt && question === cue.question && answer === cue.answer ? { verifiedAt } : {}),
});

/** Applies one change. A change naming a set or cue that is gone leaves everything as it was. */
export const changeCards = (sets: CardSet[], change: CardChange, now: Date): CardSet[] => {
  if (change.op === "delete-set") return sets.filter((set) => set.id !== change.setId);
  return sets.flatMap((set) => {
    if (set.id !== change.setId) return [set];
    switch (change.op) {
      case "edit-cue":
        return [{ ...set, cues: set.cues.map((cue) => (cue.id === change.cueId ? editedCue(cue, change.question, change.answer) : cue)) }];
      case "delete-cue": {
        const cues = set.cues.filter((cue) => cue.id !== change.cueId);
        /* The last cue going takes its set with it; there is nothing left to review. */
        if (!cues.length) return [];
        return [{ ...set, cues, learningCueId: set.learningCueId === change.cueId ? null : set.learningCueId }];
      }
      case "review":
        return [applyReview(set, change, now)];
    }
  });
};
