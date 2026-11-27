import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { changeAnnotations } from "@/lib/server/annotations";
import { backfillLedger, ledgerFile, ledgerIdle, noteEvidence, readLedger, recordEvidence } from "@/lib/server/ledger";
import { readLibrary } from "@/lib/server/library";
import { parkThread, saveParked } from "@/lib/server/parked";
import { readBookState, updateBookState } from "@/lib/server/store";
import { callTool } from "@/lib/server/tools";
import { addCards, changeCards } from "@/lib/shared/cards";
import { recordSitting } from "@/lib/shared/sitting";
import { chapterCounts, evidenceOf, evidenceStrength, ledgerItems, newEvents, weakest, type Evidence, type LedgerEvent } from "@/lib/shared/ledger";
import type { Anchor, BookId, LibraryBook } from "@/lib/shared/types";
import { makeEpub } from "./fixtures/books";

const DAY = 86_400_000;
const T0 = Date.parse("2026-03-01T10:00:00.000Z");
const at = (days: number) => new Date(T0 + days * DAY).toISOString();
const BOOK = "b".repeat(40) as BookId;

/** A check on one item: right or wrong, unaided unless said otherwise. */
const check = (id: string, days: number, outcome: number | null, more: Partial<Evidence> = {}): Evidence => ({
  id,
  at: at(days),
  bookId: BOOK,
  item: "topic:locking",
  anchor: null,
  chapter: "Orbits",
  source: outcome === null ? "highlight" : "card",
  outcome,
  unaided: outcome !== null,
  hintLevel: 0,
  confidence: null,
  topic: "Tidal locking",
  ...more,
});

const stateAfter = (evidence: Evidence[], days: number) => ledgerItems(newEvents([], evidence), new Date(T0 + days * DAY))[0];

describe("evidence strength", () => {
  const event = (more: Partial<LedgerEvent>) => ({ outcome: 1, unaided: true, hintLevel: 0, daysSince: 2, ...more });

  it("is strong only for an unaided answer a day or more after the last meeting", () => {
    expect(evidenceStrength(event({}))).toBe("strong");
    expect(evidenceStrength(event({ daysSince: 1 }))).toBe("strong");
    expect(evidenceStrength(event({ outcome: 0 }))).toBe("strong");
  });

  it("is medium for an unaided answer on the same day, or with nothing met before", () => {
    expect(evidenceStrength(event({ daysSince: 0.99 }))).toBe("medium");
    expect(evidenceStrength(event({ daysSince: null }))).toBe("medium");
  });

  it("is weak when hinted or only recognised, however long ago", () => {
    expect(evidenceStrength(event({ hintLevel: 1 }))).toBe("weak");
    expect(evidenceStrength(event({ unaided: false }))).toBe("weak");
  });

  it("is exposure when nothing was checked", () => {
    expect(evidenceStrength(event({ outcome: null, unaided: false }))).toBe("exposure");
  });
});

describe("adding to the log", () => {
  it("counts days from the last meeting with the same item in the same book", () => {
    const [first, second, other] = newEvents([], [check("a", 0, null), check("b", 3, 1), check("c", 3, 1, { item: "topic:craters" })]);
    expect(first.daysSince).toBeNull();
    expect(second.daysSince).toBe(3);
    expect(other.daysSince).toBeNull();
  });

  it("counts from when the item was made when that left no event", () => {
    expect(newEvents([], [check("a", 2, 1, { exposedAt: at(0) })])[0].daysSince).toBe(2);
  });

  it("skips what the log already holds, and places late evidence by its time", () => {
    const log = newEvents([], [check("a", 0, null), check("c", 5, 1)]);
    expect(newEvents(log, [check("a", 0, null), check("c", 5, 1)])).toEqual([]);
    expect(newEvents(log, [check("b", 4, 1)])[0].daysSince).toBe(4);
  });
});

describe("where an item stands", () => {
  it("is untested until something checks it", () => {
    expect(stateAfter([check("a", 0, null)], 1)).toMatchObject({ state: "untested", recall: null, checks: 0 });
  });

  it("is shaky when right only on the day it was met", () => {
    expect(stateAfter([check("a", 0, null), check("b", 0.1, 1)], 0.2)).toMatchObject({ state: "shaky", why: "Right, but not yet after a day away" });
  });

  it("is held once recalled unaided after a day away", () => {
    expect(stateAfter([check("a", 0, null), check("b", 2, 1)], 2.1)).toMatchObject({ state: "held", strongChecks: 1 });
  });

  it("is not held on hinted answers alone", () => {
    expect(stateAfter([check("a", 0, null), check("b", 2, 1, { hintLevel: 1 }), check("c", 4, 1, { unaided: false })], 4.1)).toMatchObject({ state: "shaky", why: "Only right with help so far" });
  });

  it("fades from held to shaky when left unchecked", () => {
    const evidence = [check("a", 0, null), check("b", 2, 1)];
    expect(stateAfter(evidence, 3).state).toBe("held");
    const later = stateAfter(evidence, 200);
    expect(later.state).toBe("shaky");
    expect(later.why).toBe("Not checked for 198 days");
  });

  it("is shaky after a miss until proven again after a day away", () => {
    const missed = [check("a", 0, null), check("b", 2, 1), check("c", 4, 0, { confidence: 90 })];
    expect(stateAfter(missed, 4.1)).toMatchObject({ state: "shaky", misconception: true });
    expect(stateAfter([...missed, check("d", 4.01, 1)], 4.1).state).toBe("shaky");
    expect(stateAfter([...missed, check("d", 4.01, 1), check("e", 6, 1)], 6.1).state).toBe("held");
  });

  it("ranks a confident miss, then a miss, then the faded, then the unchecked, and leaves out what is held", () => {
    const items = ledgerItems(
      newEvents([], [
        check("h0", 0, null, { item: "held" }),
        check("h1", 2, 1, { item: "held" }),
        check("u0", 0, null, { item: "untested" }),
        check("s0", 0, 1, { item: "same-day" }),
        check("m0", 1, 0, { item: "missed" }),
        check("c0", 1, 0, { item: "sure-and-wrong", confidence: 95 }),
      ]),
      new Date(T0 + 2.5 * DAY),
    );
    expect(weakest(items, 10).map((item) => item.item)).toEqual(["sure-and-wrong", "missed", "same-day", "untested"]);
    expect(chapterCounts(items)).toEqual([{ chapter: "Orbits", held: 1, shaky: 3, untested: 1 }]);
  });
});

describe("the ledger file", () => {
  let dataDir: string;
  let book: LibraryBook;
  const anchor: Anchor = { kind: "epub", cfi: "epubcfi(/6/4!/4/2/1:0)" };
  const sources = async () => (await readLedger(dataDir)).map((event) => event.source);

  beforeAll(async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rigg-learn-ledger-"));
    const booksDir = path.join(root, "books");
    dataDir = path.join(root, "data");
    await mkdir(booksDir);
    await writeFile(path.join(booksDir, "Moons - Ada Field.epub"), makeEpub([{ title: "Orbits", paragraphs: ["A moon in tidal locking shows its planet one face."] }]));
    vi.stubEnv("BOOKS_DIR", booksDir);
    vi.stubEnv("DATA_DIR", dataDir);
    vi.stubEnv("NOTES_DIR", "");
    book = (await readLibrary()).books[0];
  });

  it("gets a line when the reader highlights, and one more when they park a question", async () => {
    await changeAnnotations(book, { op: "add-highlight", highlight: { id: "11111111-1111-4111-8111-111111111111", anchor, quote: "one face", chapterTitle: "Orbits" } }, { dataDir, notesDir: null });
    await ledgerIdle();
    expect(await readLedger(dataDir)).toMatchObject([{ source: "highlight", bookId: book.id, outcome: null, chapter: "Orbits", topic: "one face", daysSince: null }]);

    const thread = parkThread({ question: "Why one face?", selection: { text: "one face", anchor, chapterTitle: "Orbits" } }, book);
    if (typeof thread === "string") throw new Error(thread);
    await saveParked(book.id, thread, dataDir);
    await ledgerIdle();
    expect(await sources()).toEqual(["highlight", "parked"]);
  });

  it("is rebuilt from the book files, and a second run adds nothing", async () => {
    const day = (n: number) => new Date(Date.parse("2026-04-01T09:00:00.000Z") + n * DAY);
    await updateBookState(book.id, (state) => {
      const { sets } = addCards(state.cardSets, { anchor, quote: "one face", chapterTitle: "Orbits", fact: "A locked moon shows one face.", cards: [{ question: "What does it show?", answer: "One face." }] }, day(0), () => "set-1");
      const rate = (current: typeof sets, when: Date) => changeCards(current, { op: "review", setId: "set-1", cueId: "set-1", rating: "good", reps: current[0].schedule.reps, confidence: 80, thinking: null }, when);
      return {
        ...state,
        cardSets: rate(rate(sets, day(1)), day(3)),
        quizzes: [
          {
            chapter: "Orbits",
            createdAt: day(0).toISOString(),
            questions: [{ id: "q1", kind: "recall", question: "Which face does a locked moon show?", answer: "The same one.", anchor, quote: "one face" }],
            attempts: [{ at: day(2).toISOString(), passed: false, answers: [{ questionId: "q1", correct: false, confidence: null, thinking: null }] }],
          },
        ],
        boards: [{ id: "chapter-12345678", title: "Orbits", kind: "chapter", chapter: "Orbits", labels: ["Orbits"], path: null, attempts: [{ at: day(4).toISOString(), correct: true }] }],
      };
    });

    const dry = await backfillLedger(dataDir, { dryRun: true });
    expect(dry).toMatchObject({ books: 1, found: 6, added: 4 });
    expect(Object.values(dry.bySource).reduce((a, b) => a + b, 0)).toBe(4);
    expect(Object.values(dry.byStrength).reduce((a, b) => a + (b ?? 0), 0)).toBe(4);
    expect((await readFile(ledgerFile(dataDir), "utf8")).trim().split("\n")).toHaveLength(2);
    expect(await backfillLedger(dataDir)).toMatchObject({ books: 1, found: 6, added: 4 });
    const lines = (await readFile(ledgerFile(dataDir), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(6);
    expect(await backfillLedger(dataDir)).toMatchObject({ books: 1, found: 6, added: 0 });
    expect((await readFile(ledgerFile(dataDir), "utf8")).trim().split("\n")).toEqual(lines);

    const cards = (await readLedger(dataDir)).filter((event) => event.source === "card");
    expect(cards).toMatchObject([
      { outcome: 1, confidence: 80, topic: "A locked moon shows one face.", unaided: true },
      { outcome: 1, daysSince: 2 },
    ]);
    expect(evidenceStrength(cards[1])).toBe("strong");
    expect(evidenceOf(book.id, await readBookState(book.id))).toHaveLength(6);
  });

  it("never fails the action it rides on", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    /* A file where the data folder should be: the ledger can't be written there. */
    const blocked = path.join(path.dirname(dataDir), "not-a-folder");
    await writeFile(blocked, "");
    expect(() => noteEvidence([check("x", 0, null)], blocked)).not.toThrow();
    await ledgerIdle();
    expect(logged).toHaveBeenCalledWith("Could not write the learner ledger:", expect.anything());
    logged.mockRestore();
  });

  it("answers an agent: what is weakest, a query by topic, and an event written through the tool", async () => {
    const call = async <T>(name: string, args: unknown): Promise<T> => {
      const result = await callTool(name, args, "test-agent");
      if (!result.ok) throw new Error(result.error);
      return result.value as T;
    };
    const weak = await call<{ counts: unknown; weakest: { topic: string; why: string; state: string }[]; chapters: unknown[] }>("weakest_items", { bookId: book.id });
    expect(weak.weakest[0]).toMatchObject({ topic: "Which face does a locked moon show?", state: "shaky", why: "Missed last time" });
    expect(weak.chapters).toHaveLength(1);

    const recorded = await call<{ recorded: { outcome: number | null } }>("record_evidence", { bookId: book.id, source: "focus-recall", topic: "Why the far side is never seen", chapter: "Orbits", outcome: 1, help: "hint" });
    expect(recorded.recorded.outcome).toBe(1);
    const found = await call<{ items: { state: string; why: string }[]; recentEvents: { hintLevel: number; unaided: boolean }[] }>("query_ledger", { topic: "far side" });
    expect(found.items).toMatchObject([{ state: "shaky", why: "Only right with help so far" }]);
    expect(found.recentEvents).toMatchObject([{ hintLevel: 1, unaided: false, source: "focus-recall" }]);

    const refused = await callTool("record_evidence", { bookId: book.id, source: "quiz", topic: "x", anchor: { kind: "pdf", page: 1, start: 0, end: 1 } }, "test-agent");
    expect(refused).toMatchObject({ ok: false });
    await recordEvidence([]);
  });
});

describe("a chapter test that mixes chapters", () => {
  it("gives one event for each answer, on the quiz its question belongs to, written answers included", () => {
    const anchor: Anchor = { kind: "pdf", page: 1, start: 0, end: 9 };
    const quiz = (chapter: string, id: string, kind: "recall" | "why") => ({
      chapter,
      createdAt: at(0),
      questions: [{ id, kind, question: `${chapter}?`, answer: "Yes.", anchor, quote: "q", verifiedAt: at(0) }],
      attempts: [],
    });
    const turn = { at: at(1), answer: "Because.", verdict: "right" as const, score: 1, unsure: false, gap: null, hintsUsed: 0, override: null };
    const answers = [
      { questionId: "two", correct: true, confidence: null, thinking: null, turn },
      { questionId: "one", correct: false, confidence: null, thinking: null, again: true },
    ];
    const tested = recordSitting([quiz("One", "one", "recall"), quiz("Two", "two", "why")], { chapter: "Two", kind: "test", answers }, new Date(at(1)))!;
    const retested = recordSitting(tested, { chapter: "Two", kind: "retest", retestOf: at(1), answers: [{ questionId: "one", correct: true, confidence: null, thinking: null }] }, new Date(at(2)))!;
    const events = newEvents([], evidenceOf(BOOK, { highlights: [], threads: [], cardSets: [], boards: [], quizzes: retested }));
    expect(events.map((event) => [event.item, event.outcome, event.unaided, event.hintLevel, evidenceStrength(event)])).toEqual([
      ["quiz:One:one", 0, true, 0, "strong"],
      ["quiz:Two:two", 1, true, 0, "strong"],
      ["quiz:One:one", 1, true, 0, "strong"],
    ]);
  });
});
