import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readBookState, updateBookState } from "@/lib/server/store";
import { addCards, changeCards } from "@/lib/shared/cards";
import { bankQuizzes, isQuizSet, typeOf } from "@/lib/shared/items";
import { evidenceOf, evidenceStrength, newEvents, studyEvidence, type Evidence } from "@/lib/shared/ledger";
import type { ChapterQuiz } from "@/lib/shared/quiz";
import { hasDeferred, newSchedule, reviewQueue } from "@/lib/shared/schedule";
import type { LearnerTurn, StudyThread } from "@/lib/shared/study";
import { cleanLoad, emptyBookState, type Anchor, type BookId, type CardSet, type DailyLoad } from "@/lib/shared/types";
import { parseCardFields } from "@/lib/server/cards/reply";

const BOOK = "c".repeat(40) as BookId;
const DAY = 86_400_000;
const T0 = Date.parse("2026-03-01T10:00:00.000Z");
const at = (days: number) => new Date(T0 + days * DAY).toISOString();
const anchor = (n: number): Anchor => ({ kind: "epub", cfi: `epubcfi(/6/4!/4/${n})` });

const quiz = (attempts: ChapterQuiz["attempts"] = [], anchors = [1, 2]): ChapterQuiz => ({
  chapter: "Orbits",
  createdAt: at(0),
  questions: anchors.map((n, i) => ({ id: `q${i}`, kind: i === 1 ? "why" : "recall", question: `Question ${i}?`, answer: `Answer ${i}`, anchor: anchor(n), quote: `Quote ${i}`, verifiedAt: at(0) })),
  attempts,
});
const attempt = (days: number, correct: boolean[]): ChapterQuiz["attempts"][number] => ({
  at: at(days),
  passed: false,
  answers: correct.map((c, i) => ({ questionId: `q${i}`, correct: c, confidence: null, thinking: null })),
});

const base = (more: Partial<ReturnType<typeof emptyBookState>>) => ({ ...emptyBookState(), ...more });

describe("banking quiz questions", () => {
  it("waits until the quiz has been taken, so the bank never shows a test's answers first", () => {
    const state = base({ quizzes: [quiz()] });
    const { cardSets, banked } = bankQuizzes(state);
    expect(cardSets).toBe(state.cardSets);
    expect(banked).toEqual([]);
  });

  it("moves each answered question in as an item, flip for recall and free for why, with a replayed schedule", () => {
    const state = base({ quizzes: [quiz([attempt(1, [true, false])])] });
    const { cardSets, banked } = bankQuizzes(state);
    expect(banked).toEqual(["Orbits\nq0", "Orbits\nq1"]);
    expect(cardSets).toHaveLength(2);
    const [recall, why] = cardSets;
    expect(typeOf(recall.cues[0])).toBe("flip");
    expect(typeOf(why.cues[0])).toBe("free");
    expect(recall.cues[0].origin).toEqual({ chapter: "Orbits", questionId: "q0" });
    expect(recall.schedule.state).not.toBe("new");
    expect(recall.introducedOn).toBeNull();
    expect(recall.createdAt).toBe(at(0));
    expect(isQuizSet(recall)).toBe(true);
  });

  it("is the same on every read, so ids don't change before anything is written", () => {
    const state = base({ quizzes: [quiz([attempt(1, [true, true])])] });
    expect(bankQuizzes(state)).toEqual(bankQuizzes(state));
  });

  it("is idempotent once saved, and leaves the quizzes and cards it started with", () => {
    const own = addCards([], { anchor: anchor(1), quote: "q", chapterTitle: null, fact: "f", cards: [{ question: "Mine?", answer: "Yes" }] }, new Date(T0), () => "x1");
    const state = base({ cardSets: own.sets, quizzes: [quiz([attempt(1, [true, true])])] });
    const once = bankQuizzes(state);
    const next = { ...state, ...once };
    expect(bankQuizzes(next)).toEqual(once);
    expect(bankQuizzes(next).cardSets).toBe(next.cardSets);
    /* The question at the card's passage joins its set and leaves its schedule alone. */
    const home = once.cardSets.find((set) => set.id === "x1")!;
    expect(home.cues.map((cue) => cue.question)).toEqual(["Mine?", "Question 0?"]);
    expect(home.schedule).toEqual(own.sets[0].schedule);
    expect(state.quizzes[0].questions).toHaveLength(2);
  });

  it("does not make an item again once the reader deleted it", () => {
    const state = base({ quizzes: [quiz([attempt(1, [true, true])])] });
    const first = { ...state, ...bankQuizzes(state) };
    const gone = changeCards(first.cardSets, { op: "delete-set", setId: first.cardSets[0].id }, new Date(T0));
    const after = bankQuizzes({ ...first, cardSets: gone });
    expect(after.cardSets).toHaveLength(1);
  });

  it("replays every answer to questions that share a passage", () => {
    const state = base({ quizzes: [quiz([attempt(1, [true, true]), attempt(3, [true, false])], [1, 1])] });
    const { cardSets } = bankQuizzes(state);
    expect(cardSets).toHaveLength(1);
    expect(cardSets[0].cues).toHaveLength(2);
    expect(cardSets[0].schedule.reps).toBe(4);
  });
});

describe("reading and writing a book in place", () => {
  it("shows a taken quiz's questions as items, saves them with the next write, and keeps them after another", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bank-"));
    await updateBookState(BOOK, (state) => ({ ...state, quizzes: [quiz([attempt(1, [true, false])])] }), dataDir);
    /* The write that adds a quiz holds it as it was read; the read after it moves its questions in, and the next write saves them. */
    expect((await readBookState(BOOK, dataDir)).cardSets).toHaveLength(2);
    await updateBookState(BOOK, (state) => state, dataDir);
    const file = path.join(dataDir, `${BOOK}.json`);
    const raw = JSON.parse(await readFile(file, "utf8")) as { cardSets: unknown[]; banked: string[]; quizzes: { attempts: unknown[] }[] };
    expect(raw.cardSets).toHaveLength(2);
    expect(raw.banked).toHaveLength(2);
    expect(raw.quizzes[0].attempts).toHaveLength(1);
    await updateBookState(BOOK, (state) => ({ ...state, activeThreadId: null }), dataDir);
    expect((await readBookState(BOOK, dataDir)).cardSets).toHaveLength(2);
    /* A deleted item stays deleted through the next read and write. */
    await updateBookState(BOOK, (state) => ({ ...state, cardSets: state.cardSets.slice(1) }), dataDir);
    expect((await readBookState(BOOK, dataDir)).cardSets).toHaveLength(1);
  });

  it("keeps a test from using up the new limit or coming straight back for review", () => {
    const { cardSets } = bankQuizzes(base({ quizzes: [quiz([attempt(1, [true, false])])] }));
    expect(cardSets.every((set) => set.introducedOn === null)).toBe(true);
    const day2 = new Date(T0 + 1 * DAY + 3_600_000);
    expect(reviewQueue(cardSets, day2, { newPerDay: 20, reviewsPerDay: 60 })).toEqual([]);
  });
});

describe("the daily limit", () => {
  const load: DailyLoad = { newPerDay: 2, reviewsPerDay: 3 };
  const now = new Date(T0 + 30 * DAY);
  const set = (id: string, state: CardSet["schedule"]["state"], dueDays: number, more: Partial<CardSet> = {}): CardSet => ({
    id,
    anchor: anchor(9),
    quote: "q",
    chapterTitle: null,
    fact: id,
    cues: [{ id: `${id}c`, question: id, answer: "a", createdAt: at(0), lastRating: null }],
    schedule: { ...newSchedule(new Date(T0)), state, due: at(30 + dueDays) },
    learningCueId: null,
    introducedOn: null,
    createdAt: at(Number(id.replace(/\D/g, "")) / 100),
    ...more,
  });

  it("shows only as many due reviews and new items as the limit, most overdue first", () => {
    const sets = [set("r1", "review", -5), set("r2", "review", -4), set("r3", "review", -3), set("r4", "review", -2), set("n1", "new", 0), set("n2", "new", 0), set("n3", "new", 0)];
    expect(reviewQueue(sets, now, load).map((s) => s.id)).toEqual(["r1", "r2", "r3", "n1", "n2"]);
    expect(hasDeferred(sets, now, load)).toBe(true);
    expect(hasDeferred(sets.slice(0, 3), now, { newPerDay: 0, reviewsPerDay: 3 })).toBe(false);
  });

  it("always brings back a learning step that is ready", () => {
    const step = set("s1", "learning", -0.01);
    const sets = [step, set("r1", "review", -5)];
    expect(reviewQueue(sets, now, { newPerDay: 0, reviewsPerDay: 0 }).map((s) => s.id)).toEqual(["s1"]);
  });

  it("counts a set once however often it was rated today, and shows nothing past the limit", () => {
    const rated = (id: string, times: number) =>
      set(id, "review", 5, { introducedOn: "2026-01-01", history: Array.from({ length: times }, (_, i) => ({ at: new Date(now.getTime() - i * 60_000).toISOString(), cueId: `${id}c`, rating: "again" as const, confidence: null, thinking: null })) });
    const sets = [rated("d1", 3), rated("d2", 1), set("r1", "review", -5), set("r2", "review", -4)];
    expect(reviewQueue(sets, now, load).map((s) => s.id)).toEqual(["r1"]);
  });

  it("reads a limit as whole numbers from 0 to 500", () => {
    expect(cleanLoad({ newPerDay: 5, reviewsPerDay: 9000 })).toEqual({ newPerDay: 5, reviewsPerDay: 60 });
    expect(cleanLoad(null)).toEqual({ newPerDay: 20, reviewsPerDay: 60 });
  });
});

describe("card types", () => {
  it("keeps a choice card's options and drops them when its answer is reworded away from them", () => {
    const { sets } = addCards([], { anchor: anchor(1), quote: "q", chapterTitle: null, fact: "f", cards: [{ question: "Q?", answer: "B", type: "choice", choices: ["A", "B", "C"] }] }, new Date(T0), () => "id");
    expect(sets[0].cues[0]).toMatchObject({ type: "choice", choices: ["A", "B", "C"] });
    const kept = changeCards(sets, { op: "edit-cue", setId: "id", cueId: "id", question: "Q?", answer: "C" }, new Date(T0));
    expect(kept[0].cues[0].type).toBe("choice");
    const flipped = changeCards(sets, { op: "edit-cue", setId: "id", cueId: "id", question: "Q?", answer: "Z" }, new Date(T0));
    expect(flipped[0].cues[0].type).toBeUndefined();
    expect(flipped[0].cues[0].choices).toBeUndefined();
  });

  it("checks a proposed choice card's options", () => {
    const card = (more: object) => parseCardFields({ fact: "f", cards: [{ question: "Q?", answer: "B", ...more }] });
    expect(card({ type: "choice", choices: ["A", "B"] })).toMatchObject({ cards: [{ type: "choice", choices: ["A", "B"] }] });
    expect(typeof card({ type: "choice", choices: ["A", "C"] })).toBe("string");
    expect(typeof card({ type: "choice", choices: ["B"] })).toBe("string");
    expect(typeof card({ type: "nope" })).toBe("string");
    expect(card({})).toMatchObject({ cards: [{ question: "Q?", answer: "B" }] });
  });
});

describe("evidence from the bank, tests and Go deeper", () => {
  const strength = (evidence: Evidence[], index = 0) => {
    const event = newEvents([], evidence)[index];
    return evidenceStrength(event);
  };

  const turn = (more: Partial<LearnerTurn> = {}, when = 0): LearnerTurn => ({ at: at(when), answer: "a", verdict: "right", score: 1, unsure: false, gap: null, hintsUsed: 0, override: null, ...more });
  const thread = (turns: LearnerTurn[], messages: StudyThread["messages"] = []): StudyThread =>
    ({
      id: "t1",
      kind: "passage",
      action: "ask",
      createdAt: at(0),
      anchor: anchor(1),
      chapterTitle: "Orbits",
      quote: "Quote",
      messages,
      study: { mode: "guess", question: "Why?", expected: "Because", rubric: null, draft: "", turns },
    }) as unknown as StudyThread;

  it("records a Go deeper answer: medium in the same sitting, strong a day later", () => {
    expect(strength(studyEvidence(BOOK, thread([turn({}, 0.01)])))).toBe("medium");
    expect(strength(studyEvidence(BOOK, thread([turn({}, 2)])))).toBe("strong");
  });

  it("never makes an unsure, hinted, told or repeated answer strong", () => {
    expect(strength(studyEvidence(BOOK, thread([turn({ unsure: true, verdict: "partly", score: 0.5 }, 2)])))).toBe("weak");
    expect(strength(studyEvidence(BOOK, thread([turn({ hintsUsed: 2 }, 2)])))).toBe("weak");
    const told = thread([turn({}, 2)], [{ role: "user", content: "Just tell me.", createdAt: at(1) }] as StudyThread["messages"]);
    expect(strength(studyEvidence(BOOK, told))).toBe("weak");
    const retry = studyEvidence(BOOK, thread([turn({ verdict: "wrong", score: 0 }, 2), turn({}, 3)]));
    expect(strength(retry, 0)).toBe("strong");
    expect(strength(retry, 1)).toBe("weak");
  });

  it("adds the reader's own call as a weak check after the grade, one per call", () => {
    const events = newEvents([], studyEvidence(BOOK, thread([turn({ verdict: "wrong", score: 0, override: "right" }, 2)])));
    expect(events.map((event) => [event.outcome, evidenceStrength(event)])).toEqual([[0, "strong"], [1, "weak"]]);
    const changed = studyEvidence(BOOK, thread([turn({ verdict: "wrong", score: 0, override: "wrong" }, 2)]));
    expect(changed.map((event) => event.id)).not.toContain(studyEvidence(BOOK, thread([turn({ override: "right" }, 2)]))[1].id);
  });

  it("is idempotent when recorded twice", () => {
    const evidence = studyEvidence(BOOK, thread([turn({}, 2)]));
    const log = newEvents([], evidence);
    expect(newEvents(log, evidence)).toEqual([]);
  });

  it("marks a chapter-test answer the grader was unsure of as weak, however the reader called it", () => {
    const graded = (turnMore: Partial<LearnerTurn>) => {
      const q = quiz([{ at: at(2), passed: false, answers: [{ questionId: "q1", correct: true, confidence: null, thinking: null, turn: turn(turnMore, 2) }] }]);
      return evidenceOf(BOOK, { ...emptyBookState(), quizzes: [q] }).filter((event) => event.source === "quiz");
    };
    expect(strength(graded({}))).toBe("strong");
    expect(strength(graded({ unsure: true, verdict: "partly", score: 0.5, override: "right" }))).toBe("weak");
    /* A sure grade the reader overruled keeps the grader's mark as strong evidence and adds their call as a weak check. */
    const overruled = newEvents([], graded({ verdict: "wrong", score: 0, override: "right" }));
    expect(overruled.map((event) => [event.outcome, evidenceStrength(event)])).toEqual([[0, "strong"], [1, "weak"]]);
    expect(newEvents([], graded({ unsure: true, verdict: "partly", score: 0.5 }))[0].outcome).toBe(0.5);
  });

  it("marks a card picked from options as weak, and keeps a quiz question's bank reviews on the quiz item", () => {
    const state = base({ quizzes: [quiz([attempt(1, [true, true])])] });
    const banked = { ...state, ...bankQuizzes(state) };
    const set = banked.cardSets[0];
    const reviewed: CardSet = { ...set, history: [{ at: at(5), cueId: set.cues[0].id, rating: "good", confidence: null, thinking: null, aided: true }] };
    const [event] = evidenceOf(BOOK, { ...banked, cardSets: [reviewed, ...banked.cardSets.slice(1)], quizzes: [] });
    expect(event.item).toBe("quiz:Orbits:q0");
    expect(event.unaided).toBe(false);
    expect(strength([event])).toBe("weak");
  });
});
