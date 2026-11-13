import { describe, expect, it } from "vitest";
import { parseCardReply } from "@/lib/server/cards/reply";
import { addCards, changeCards, type NewCards } from "@/lib/shared/cards";
import type { CardSet } from "@/lib/shared/types";

const now = new Date("2026-03-10T09:00:00Z");
let n = 0;
const newId = () => `id${++n}`;

const passage = (overrides: Partial<NewCards> = {}): NewCards => ({
  anchor: { kind: "pdf", page: 4, start: 10, end: 60 },
  quote: "Catastrophic forgetting is ...",
  chapterTitle: "Fine-tuning",
  fact: "Fine-tuning can erase what the model knew.",
  cards: [
    { question: "What is catastrophic forgetting?", answer: "Losing earlier knowledge after fine-tuning." },
    { question: "What is this risk called?", answer: "Catastrophic forgetting." },
  ],
  ...overrides,
});

describe("reading the tutor's cards", () => {
  it("takes the first JSON object, ignoring a fence or a second attempt after it", () => {
    const reply = '```json\n{"fact": "A", "cards": [{"question": "Q {1}?", "answer": "A"}]}\n```\nWait, corrected:\n{"fact": "B", "cards": []}';
    expect(parseCardReply(reply)).toEqual({ fact: "A", cards: [{ question: "Q {1}?", answer: "A" }] });
  });

  it("accepts no fact with a reason", () => {
    expect(parseCardReply('{"fact": null, "reason": "Only a heading.", "cards": []}')).toEqual({ fact: null, reason: "Only a heading." });
  });

  it("drops a repeated question and keeps at most three", () => {
    const cards = ["One?", "one", "Two?", "Three?", "Four?"].map((question) => ({ question, answer: "x" }));
    const parsed = parseCardReply(JSON.stringify({ fact: "F", cards }));
    expect(parsed).toMatchObject({ cards: [{ question: "One?" }, { question: "Two?" }, { question: "Three?" }] });
  });

  it("explains what to fix when the reply can't be used", () => {
    expect(parseCardReply("Sorry, no.")).toBe("The reply had no JSON object.");
    expect(parseCardReply('{"fact": "F", "cards": []}')).toMatch(/one to three cards/);
    expect(parseCardReply('{"fact": "F", "cards": [{"question": "Q"}]}')).toMatch(/non-empty/);
  });
});

describe("storing cards", () => {
  it("makes a new set with one schedule for a new passage", () => {
    const { sets, count } = addCards([], passage(), now, newId);
    expect(count).toBe(2);
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ fact: "Fine-tuning can erase what the model knew.", schedule: { state: "new", reps: 0 }, introducedOn: null });
  });

  it("adds new questions to the passage's existing set and keeps its schedule", () => {
    const first = addCards([], passage(), now, newId).sets;
    const reviewed = changeCards(first, { op: "review", setId: first[0].id, cueId: first[0].cues[0].id, rating: "good", reps: 0 }, now);
    const { sets, count } = addCards(
      reviewed,
      passage({ cards: [{ question: "what is catastrophic forgetting", answer: "dup" }, { question: "Which three choices reduce it?", answer: "Small data, few epochs, right rate." }] }),
      now,
      newId,
    );
    expect(count).toBe(1);
    expect(sets).toHaveLength(1);
    expect(sets[0].cues.map((c) => c.question)).toHaveLength(3);
    expect(sets[0].schedule).toEqual(reviewed[0].schedule);
  });

  it("edits and deletes cues, and a set goes with its last cue", () => {
    const [set] = addCards([], passage(), now, newId).sets;
    const [a, b] = set.cues;
    let sets: CardSet[] = changeCards([set], { op: "edit-cue", setId: set.id, cueId: a.id, question: "New Q?", answer: "New A." }, now);
    expect(sets[0].cues[0]).toMatchObject({ question: "New Q?", answer: "New A." });
    sets = changeCards(sets, { op: "delete-cue", setId: set.id, cueId: a.id }, now);
    expect(sets[0].cues.map((c) => c.id)).toEqual([b.id]);
    expect(changeCards(sets, { op: "delete-cue", setId: set.id, cueId: b.id }, now)).toEqual([]);
    expect(changeCards([set], { op: "delete-set", setId: set.id }, now)).toEqual([]);
  });

  it("forgets the pinned cue when it is deleted", () => {
    const [set] = addCards([], passage(), now, newId).sets;
    const [a] = set.cues;
    const failed = changeCards([set], { op: "review", setId: set.id, cueId: a.id, rating: "again", reps: 0 }, now);
    expect(failed[0].learningCueId).toBe(a.id);
    expect(changeCards(failed, { op: "delete-cue", setId: set.id, cueId: a.id }, now)[0].learningCueId).toBeNull();
  });
});
