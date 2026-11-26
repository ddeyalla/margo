import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gradeQuizAnswer, QuizGradeError } from "@/lib/server/quiz/grade";
import { readBookState, updateBookState } from "@/lib/server/store";
import type { Provider, TutorEvent, TutorTurn } from "@/lib/server/tutor/types";
import { isPassed, type ChapterQuiz, type QuizAnswer } from "@/lib/shared/quiz";
import { answerSitting, askable, bookChapters, composeTest, earlierQuizzes, isRepeat, nextRetest, recordSitting, retestDue, sittingDone, startSitting } from "@/lib/shared/sitting";
import type { Anchor, BookId } from "@/lib/shared/types";

const anchor = { kind: "epub", cfi: "epubcfi(/6/2!/4/2)" } as unknown as Anchor;

const quiz = (chapter: string, count: number, { verified = true, whyAt = 0 as number | null } = {}): ChapterQuiz => ({
  chapter,
  questions: Array.from({ length: count }, (_, i) => ({
    id: `${chapter}-${i}`,
    kind: i === whyAt ? ("why" as const) : ("recall" as const),
    question: `${chapter} Q${i}?`,
    answer: `A${i}`,
    anchor,
    quote: "…",
    ...(verified ? { verifiedAt: "2026-11-26T00:00:00.000Z" } : {}),
  })),
  createdAt: `2026-11-2${chapter.length}T00:00:00.000Z`,
  attempts: [],
});

const answer = (questionId: string, correct: boolean, confidence: number | null = null): QuizAnswer => ({ questionId, correct, confidence, thinking: null });
const ids = (items: { question: { id: string } }[]) => items.map((item) => item.question.id);

describe("bookChapters", () => {
  it("takes the top-level entries and leaves their sections to them", () => {
    const toc = [
      { label: "Cover", depth: 0 },
      { label: "Introduction", depth: 0 },
      { label: "1. Start", depth: 0 },
      { label: "A section", depth: 1 },
      { label: "2. Middle", depth: 0 },
      { label: "Acknowledgments", depth: 0 },
      { label: "Index", depth: 0 },
    ];
    expect(bookChapters(toc)).toEqual(["Introduction", "1. Start", "2. Middle"]);
  });
  it("takes the chapters under a Part, not the Part", () => {
    const toc = [
      { label: "Part One: Basics", depth: 0 },
      { label: "Chapter 1", depth: 1 },
      { label: "Detail", depth: 2 },
      { label: "Chapter 2", depth: 1 },
      { label: "Part of the problem", depth: 0 },
      { label: "Epilogue", depth: 0 },
    ];
    expect(bookChapters(toc)).toEqual(["Chapter 1", "Chapter 2", "Part of the problem", "Epilogue"]);
  });
  it("leaves alone anything that overlaps a Course's chapter, above or below it", () => {
    const toc = [
      { label: "One", depth: 0 },
      { label: "One, section", depth: 1 },
      { label: "Two", depth: 0 },
      { label: "Three", depth: 0 },
    ];
    expect(bookChapters(toc, ["One, section", "Two"])).toEqual(["Three"]);
  });
  it("gives a repeated label to its first entry only", () => {
    expect(bookChapters([{ label: "Notes on method", depth: 0 }, { label: "Notes on method", depth: 0 }])).toEqual(["Notes on method"]);
  });
});

describe("earlierQuizzes", () => {
  const quizzes = [quiz("Three", 5), quiz("One", 5), quiz("Two", 5)];
  const toc = ["One", "Two", "Three"].map((label) => ({ label, depth: 0 }));
  it("goes by the contents", () => {
    expect(earlierQuizzes(quizzes, "Two", toc).map((q) => q.chapter)).toEqual(["One"]);
    expect(earlierQuizzes(quizzes, "One", toc)).toEqual([]);
  });
  it("goes by when they were written without one", () => {
    expect(earlierQuizzes(quizzes, "Three", null).map((q) => q.chapter)).toEqual(["One", "Two"]);
  });
});

describe("composeTest", () => {
  it("asks the whole quiz when there is nothing earlier, one of its questions as an explain", () => {
    const items = composeTest(quiz("One", 8), []);
    expect(items).toHaveLength(8);
    expect(items.filter((item) => item.format === "explain").map((item) => item.question.id)).toEqual(["One-0"]);
    expect(items.every((item) => !item.review)).toBe(true);
  });
  it("mixes about seven of the chapter's to three from earlier, six to eight in all", () => {
    for (const [own, total] of [[3, 6], [4, 6], [5, 7], [6, 8], [8, 8]]) {
      const items = composeTest(quiz("Two", own), [quiz("One", 8)]);
      expect(items).toHaveLength(total);
      expect(items.filter((item) => item.review)).toHaveLength(total - Math.min(own, 6));
      expect(items[0].review).toBe(false);
    }
  });
  it("uses what earlier questions there are when they are few", () => {
    expect(composeTest(quiz("Two", 8), [quiz("One", 1)]).filter((item) => item.review)).toHaveLength(1);
  });
  it("keeps the why when the chapter's questions are trimmed, and spreads a first test over the chapter", () => {
    const items = composeTest(quiz("Two", 8, { whyAt: 7 }), [quiz("One", 5)]).filter((item) => !item.review);
    expect(items.find((item) => item.format === "explain")?.question.id).toBe("Two-7");
    expect(ids(items)).toEqual(["Two-0", "Two-1", "Two-2", "Two-4", "Two-5", "Two-7"]);
  });
  it("explains a recall question when the quiz has no why", () => {
    expect(composeTest(quiz("One", 4, { whyAt: null }), []).filter((item) => item.format === "explain")).toHaveLength(1);
  });
  it("prefers earlier questions answered wrong, then ones never asked", () => {
    const one = quiz("One", 5);
    one.attempts = [{ at: "2026-11-20T10:00:00.000Z", passed: false, answers: [answer("One-0", true), answer("One-1", true), answer("One-3", false)] }];
    expect(ids(composeTest(quiz("Two", 6), [one]).filter((item) => item.review))).toEqual(["One-2", "One-3"]);
  });
  it("never draws an unchecked question from another chapter, but still asks an old quiz of its own", () => {
    const old = quiz("One", 5, { verified: false });
    expect(composeTest(quiz("Two", 6), [old]).some((item) => item.review)).toBe(false);
    expect(composeTest(old, [])).toHaveLength(5);
    expect(askable(old)).toHaveLength(5);
  });
  it("shows only the checked questions of a quiz that has some", () => {
    const mixed = quiz("One", 5);
    delete mixed.questions[4].verifiedAt;
    expect(askable(mixed)).toHaveLength(4);
  });
});

describe("a sitting", () => {
  it("asks a missed question once more, at the end, and scores the first answer", () => {
    let sitting = startSitting(composeTest(quiz("One", 3), []));
    sitting = answerSitting(sitting, answer("One-0", false));
    expect(sitting.queue).toHaveLength(4);
    sitting = answerSitting(answerSitting(sitting, answer("One-1", true)), answer("One-2", true));
    expect(sittingDone(sitting)).toBe(false);
    expect(isRepeat(sitting)).toBe(true);
    sitting = answerSitting(sitting, answer("One-0", false));
    expect(sittingDone(sitting)).toBe(true);
    expect(sitting.queue).toHaveLength(4);
    expect(sitting.answers).toEqual([{ ...answer("One-0", false), again: false }, answer("One-1", true), answer("One-2", true)]);
  });
});

describe("recordSitting", () => {
  const at = new Date("2026-11-26T10:00:00Z");
  const quizzes = [quiz("One", 5), quiz("Two", 6)];
  const all = (right: number) => [...Array.from({ length: 6 }, (_, i) => answer(`Two-${i}`, i < right)), answer("One-0", true), answer("One-1", true)];

  it("passes a test at 80 % of everything asked, and gives each quiz its own answers", () => {
    const saved = recordSitting(quizzes, { chapter: "Two", kind: "test", answers: all(5) }, at)!;
    const [one, two] = saved;
    expect(two.attempts[0]).toMatchObject({ kind: "test", passed: true, right: 7, of: 8, at: at.toISOString() });
    expect(two.attempts[0].answers).toHaveLength(6);
    expect(one.attempts[0]).toMatchObject({ kind: "review", passed: false, at: at.toISOString() });
    expect(one.attempts[0].answers).toHaveLength(2);
    expect(isPassed(two)).toBe(true);
    expect(isPassed(one)).toBe(false);
    expect(recordSitting(quizzes, { chapter: "Two", kind: "test", answers: all(4) }, at)![1].attempts[0].passed).toBe(false);
  });
  it("doesn't pass on too few of the chapter's own questions", () => {
    expect(recordSitting(quizzes, { chapter: "Two", kind: "test", answers: all(6).slice(3) }, at)![1].attempts[0].passed).toBe(false);
  });
  it("drops unknown and repeated answers, and has no quiz to save to for an unknown chapter", () => {
    const saved = recordSitting(quizzes, { chapter: "Two", kind: "test", answers: [...all(6), answer("Two-0", false), answer("nope", true)] }, at)!;
    expect(saved[1].attempts[0]).toMatchObject({ right: 8, of: 8 });
    expect(recordSitting(quizzes, { chapter: "Nine", kind: "test", answers: [] }, at)).toBeNull();
  });
  it("never passes a chapter on a retest", () => {
    const saved = recordSitting(quizzes, { chapter: "Two", kind: "retest", retestOf: "t", answers: all(6) }, at)!;
    expect(saved[1].attempts[0]).toMatchObject({ kind: "retest", retestOf: "t", passed: false });
  });
});

describe("retestDue", () => {
  const taken = new Date(2026, 10, 26, 10);
  const nextDay = new Date(2026, 10, 27, 9);
  const sat = (answers: QuizAnswer[]) => recordSitting([quiz("One", 5), quiz("Two", 6)], { chapter: "Two", kind: "test", answers }, taken)!;
  const answers = [answer("Two-0", false), answer("Two-1", true, 90), answer("Two-2", true, 20), answer("Two-3", true), answer("One-0", false), answer("One-1", true, 50)];

  it("is not due on the day of the test", () => {
    expect(retestDue(sat(answers), "Two", [], new Date(2026, 10, 26, 23))).toBeNull();
  });
  it("asks the misses from every chapter, filled to three with what the reader was least sure of", () => {
    const due = retestDue(sat(answers), "Two", [], nextDay)!;
    expect(ids(due.items)).toEqual(["One-0", "Two-0", "Two-2"]);
    expect(due.missed).toBe(2);
    expect(due.items[0].review).toBe(true);
    expect(due.of).toBe(taken.toISOString());
  });
  it("asks at most four", () => {
    expect(retestDue(sat(answers.map((a) => ({ ...a, correct: false }))), "Two", [], nextDay)!.items).toHaveLength(4);
  });
  it("is nothing after a clean test, once taken, or once passed over", () => {
    expect(retestDue(sat(answers.map((a) => ({ ...a, correct: true }))), "Two", [], nextDay)).toBeNull();
    const saved = sat(answers);
    expect(retestDue(saved, "Two", [{ chapter: "Two", retestOf: taken.toISOString() }], nextDay)).toBeNull();
    expect(nextRetest(saved, [], nextDay)?.chapter).toBe("Two");
    const retaken = recordSitting(saved, { chapter: "Two", kind: "retest", retestOf: taken.toISOString(), answers: [answer("One-0", true)] }, nextDay)!;
    expect(retestDue(retaken, "Two", [], new Date(2026, 10, 28, 9))).toBeNull();
  });
  it("leaves whole quizzes taken before tests alone", () => {
    const old = quiz("One", 5);
    old.attempts = [{ at: taken.toISOString(), passed: false, answers: [answer("One-0", false)] }];
    expect(retestDue([old], "One", [], nextDay)).toBeNull();
  });
});

describe("gradeQuizAnswer", () => {
  const bookId = "d".repeat(40) as BookId;
  const QUOTE = "The tide is raised mostly by the Moon. The Sun's pull is weaker because it is so much farther away.";
  /** A grader that writes a one-point rubric, then marks it "partly". Keeps each request it was sent. */
  const grader = (seen: TutorTurn[]) => ({
    model: "check",
    provider: {
      id: "api",
      label: "Scripted",
      probe: async () => ({ status: "ready", detail: null, version: null }),
      async *run(turn: TutorTurn): AsyncGenerator<TutorEvent> {
        seen.push(turn);
        const reply = turn.system.includes("before anyone's answer is read")
          ? { points: ["The Sun is much farther away."] }
          : { marks: ["partly"], confidence: 0.9, gap: { span: "because it is so much farther away", note: "The answer doesn't say why." } };
        yield { type: "text", delta: JSON.stringify(reply) };
      },
    } as Provider,
  });

  it("grades against the question's text, keeps the rubric for next time, and saves nothing else", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rigg-learn-quiz-"));
    const saved = quiz("One", 3);
    saved.questions[0].quote = QUOTE;
    await updateBookState(bookId, (state) => ({ ...state, quizzes: [saved] }), dataDir);
    const seen: TutorTurn[] = [];
    const signal = new AbortController().signal;

    const turn = await gradeQuizAnswer(bookId, "One", "One-0", "  It is weaker.  ", grader(seen), signal, dataDir);
    expect(turn).toMatchObject({ answer: "It is weaker.", verdict: "partly", unsure: true, override: null, gap: { point: "The Sun is much farther away.", span: "because it is so much farther away" } });
    expect(seen).toHaveLength(2);
    const state = await readBookState(bookId, dataDir);
    expect(state.quizzes[0].questions[0].rubric).toEqual(["The Sun is much farther away."]);
    expect(state.quizzes[0].attempts).toEqual([]);
    expect(state.quizSkips).toEqual([]);

    await gradeQuizAnswer(bookId, "One", "One-0", "Because it is farther.", grader(seen), signal, dataDir);
    expect(seen).toHaveLength(3);
    await expect(gradeQuizAnswer(bookId, "One", "gone", "x", grader(seen), signal, dataDir)).rejects.toBeInstanceOf(QuizGradeError);
    await expect(gradeQuizAnswer(bookId, "One", "One-0", " ", grader(seen), signal, dataDir)).rejects.toBeInstanceOf(QuizGradeError);
  });
});
