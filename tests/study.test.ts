import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readBookState, updateBookState } from "@/lib/server/store";
import { answerStudy, overruleStudy, saveStudyDraft, startStudy, StudyError } from "@/lib/server/study";
import { buildTurn } from "@/lib/server/tutor/prompt";
import type { Provider, TutorEvent, TutorTurn } from "@/lib/server/tutor/types";
import { EXPLAIN_BACK_QUESTION, gradeNote, hintsGiven, isStudy, locateSpan, offersYourTurn, seenBefore, splitYourTurn, standing, studyState, toldAnswer, type LearnerTurn } from "@/lib/shared/study";
import { threadLabel } from "@/lib/shared/threads";
import type { BookId, LibraryBook, PassageThread, Thread } from "@/lib/shared/types";

const signal = new AbortController().signal;
const PASSAGE = "The tide is raised mostly by the Moon. The Sun's pull on the oceans is a little under half as strong, because it is so much farther away.";

const book: LibraryBook = {
  id: "c".repeat(40) as BookId,
  format: "epub",
  relPath: "tides.epub",
  folder: "",
  fileTitle: "Tides",
  fileAuthor: null,
  sizeBytes: 1,
  modifiedAt: "",
};
const label = { title: "Tides", author: null };
const selection = { text: PASSAGE, before: "", after: "", anchor: { kind: "epub", cfi: "epubcfi(/6/4!/4/2/1:0)" }, chapterTitle: "Chapter 1" };

/** A tutor whose every reply comes from `reply`. Keeps each request it was sent. */
const scripted = (reply: (turn: TutorTurn) => string, seen: TutorTurn[] = []): Provider => ({
  id: "api",
  label: "Scripted",
  probe: async () => ({ status: "ready", detail: null, version: null }),
  async *run(turn): AsyncGenerator<TutorEvent> {
    seen.push(turn);
    yield { type: "text", delta: reply(turn) };
  },
});

const json = (value: unknown) => JSON.stringify(value);
const QUESTION = { question: "Why is the Sun's pull on the oceans weaker than the Moon's?", expected: "Because the Sun is so much farther away." };
const writer = (seen: TutorTurn[] = []) => ({ provider: scripted(() => json(QUESTION), seen), model: null, book: label, signal });

/** A grader that writes a one-point rubric, then gives `mark` with `confidence`. */
const grader = (mark: "yes" | "partly" | "no", confidence: number, seen: TutorTurn[] = []) => ({
  model: "check",
  provider: scripted(
    (turn) =>
      turn.system.includes("before anyone's answer is read")
        ? json({ points: ["The Sun is much farther away than the Moon."] })
        : json({ marks: [mark], confidence, gap: mark === "yes" ? null : { span: "because it is so much farther away", note: "The answer doesn't say the Sun is farther away." } }),
    seen,
  ),
});

const tmp = () => mkdtemp(path.join(tmpdir(), "margo-study-"));

const asked = (overrides: Partial<PassageThread> = {}): PassageThread => ({
  kind: "passage",
  id: "ask-1",
  anchor: { kind: "epub", cfi: "epubcfi(/6/4!/4/2/1:0)" },
  quote: PASSAGE,
  before: "",
  after: "",
  chapterTitle: "Chapter 1",
  action: "ask",
  provider: "claude",
  sessionId: "s1",
  createdAt: "2026-11-20T00:00:00.000Z",
  messages: [
    { role: "user", content: "Why two tides?", createdAt: "" },
    { role: "assistant", content: "The Moon pulls the near side hardest.\n\nYour turn: Why is the Sun's pull weaker?", createdAt: "" },
  ],
  ...overrides,
});

const save = (dir: string, ...threads: Thread[]) => updateBookState(book.id, (state) => ({ ...state, threads: [...state.threads, ...threads] }), dir);

describe("an answer's closing prompt", () => {
  it("is split from the answer, bold or not", () => {
    expect(splitYourTurn("It pulls.\n\nYour turn: Why is it weaker?")).toEqual({ body: "It pulls.", prompt: "Why is it weaker?" });
    expect(splitYourTurn("It pulls.\n**Your turn:** Why is it weaker?\n")).toEqual({ body: "It pulls.", prompt: "Why is it weaker?" });
  });
  it("loses the marks of a line set wholly in bold", () => {
    expect(splitYourTurn("It pulls.\n\n**Your turn: Why is it weaker?**").prompt).toBe("Why is it weaker?");
  });
  it("is only the last line, and an answer without one is left as it is", () => {
    expect(splitYourTurn("Your turn: early?\nMore words.").prompt).toBeNull();
    expect(splitYourTurn("Just an answer.")).toEqual({ body: "Just an answer.", prompt: null });
    expect(splitYourTurn("Your turn:").prompt).toBeNull();
  });
  it("is offered on Ask threads only", () => {
    expect(offersYourTurn(asked())).toBe(true);
    expect(offersYourTurn(asked({ action: "explain" }))).toBe(true);
    expect(offersYourTurn(asked({ action: "work" }))).toBe(false);
    expect(offersYourTurn(asked({ action: "deeper" }))).toBe(false);
  });
});

describe("what the tutor is asked", () => {
  const first = (thread: Thread) => buildTurn(label, thread, null, new Map()).messages[0].content;

  it("answers Ask briefly, typed or not, and may close with one prompt", () => {
    for (const thread of [asked(), asked({ action: "explain", messages: [{ role: "user", content: "Explain this passage.", createdAt: "" }] })]) {
      expect(first(thread)).toContain("about 120 words at most");
      expect(first(thread)).toContain('"Your turn: "');
      expect(first(thread)).toContain("Never add it to a later reply.");
    }
    expect(first(asked())).toContain("My question: Why two tides?");
  });

  it("still runs threads saved under the old actions on their own rules", () => {
    const old = (action: PassageThread["action"]) => first(asked({ action, messages: [{ role: "user", content: "My words.", createdAt: "" }] }));
    expect(old("work")).toContain("Lead me to the answer");
    expect(old("explainBack")).toContain("Check my explanation against the passage.");
    expect(old("deeper")).toContain("Don't explain yet.");
    expect(old("work")).not.toContain("Your turn");
    expect(threadLabel(asked({ action: "work" }))).toBe("Work it out");
    expect(isStudy(asked({ action: "deeper" }))).toBe(false);
  });
});

describe("whether a passage was asked about before", () => {
  it("counts a thread on the same text, on text around it or on part of it", () => {
    expect(seenBefore([asked()], PASSAGE)).toBe(true);
    expect(seenBefore([asked()], "the  Sun's pull on the oceans")).toBe(true);
    expect(seenBefore([asked({ quote: "raised mostly by the Moon" })], PASSAGE)).toBe(true);
    expect(seenBefore([asked()], "Another passage altogether.")).toBe(false);
  });
  it("doesn't count a thread on a word or two that the passage happens to hold", () => {
    expect(seenBefore([asked({ quote: "the Moon" })], PASSAGE)).toBe(false);
    expect(seenBefore([asked({ quote: "the Moon" })], "The Moon")).toBe(true);
    expect(seenBefore([asked()], "the Sun")).toBe(false);
  });
  it("doesn't count a parked question or a recap", () => {
    expect(seenBefore([asked({ parkedAt: "2026-11-20T00:00:00.000Z" })], PASSAGE)).toBe(false);
    expect(seenBefore([asked({ action: "recap" })], PASSAGE)).toBe(false);
  });
});

describe("the stretch of the passage a grade points at", () => {
  it("is found whatever the spacing and case", () => {
    const found = locateSpan(PASSAGE, "because  it is so much\nfarther away");
    expect(found && PASSAGE.slice(...found)).toBe("because it is so much farther away");
  });
  it("is null when it isn't there as written", () => {
    expect(locateSpan(PASSAGE, "because the Sun is distant")).toBeNull();
    expect(locateSpan(PASSAGE, "  ")).toBeNull();
  });
});

describe("opening the reader's turn", () => {
  it("has the tutor write one question for a passage not asked about, and saves it as a thread", async () => {
    const dir = await tmp();
    const seen: TutorTurn[] = [];
    const thread = await startStudy(book, { selection }, "claude", writer(seen), dir);
    expect(seen).toHaveLength(1);
    expect(seen[0].messages[0].content).toContain(`<passage>\n${PASSAGE}\n</passage>`);
    expect(thread.study).toEqual({ mode: "guess", question: QUESTION.question, expected: QUESTION.expected, rubric: null, draft: "", turns: [] });
    expect(thread.messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "Go deeper on this passage."],
      ["assistant", QUESTION.question],
    ]);
    expect(thread.action).toBe("deeper");
    expect((await readBookState(book.id, dir)).threads).toEqual([thread]);
  });

  it("asks for an explain-back, with no model call, on a passage already asked about", async () => {
    const dir = await tmp();
    await save(dir, asked());
    const seen: TutorTurn[] = [];
    const thread = await startStudy(book, { selection }, "claude", writer(seen), dir);
    expect(seen).toHaveLength(0);
    expect(thread.study).toMatchObject({ mode: "explainBack", question: EXPLAIN_BACK_QUESTION, expected: null });
  });

  it("picks up a turn left open on the same passage instead of starting another", async () => {
    const dir = await tmp();
    const first = await startStudy(book, { selection }, "claude", writer(), dir);
    const seen: TutorTurn[] = [];
    const again = await startStudy(book, { selection }, "claude", writer(seen), dir);
    expect(again.id).toBe(first.id);
    expect(seen).toHaveLength(0);
    expect((await readBookState(book.id, dir)).threads).toHaveLength(1);
  });

  it("opens the question an Ask answer closed with, on that answer's passage", async () => {
    const dir = await tmp();
    await save(dir, asked());
    const seen: TutorTurn[] = [];
    const thread = await startStudy(book, { from: "ask-1" }, "claude", writer(seen), dir);
    expect(seen).toHaveLength(0);
    expect(thread.study).toMatchObject({ mode: "guess", question: "Why is the Sun's pull weaker?", expected: "The Moon pulls the near side hardest." });
    expect(thread.quote).toBe(PASSAGE);
    expect(thread.sessionId).toBeNull();
  });

  it("refuses a selection it can't read and an answer with no prompt", async () => {
    const dir = await tmp();
    await save(dir, asked({ messages: [{ role: "user", content: "Why?", createdAt: "" }, { role: "assistant", content: "Because.", createdAt: "" }] }));
    await expect(startStudy(book, { selection: { text: "" } }, "claude", writer(), dir)).rejects.toBeInstanceOf(StudyError);
    await expect(startStudy(book, { from: "ask-1" }, "claude", writer(), dir)).rejects.toThrow("no question to try");
    await expect(startStudy(book, { from: "gone" }, "claude", writer(), dir)).rejects.toBeInstanceOf(StudyError);
  });

  it("tells the tutor the rules of the turn, and the answer it must hold back", async () => {
    const dir = await tmp();
    const thread = await startStudy(book, { selection }, "claude", writer(), dir);
    const turn = buildTurn(label, thread, null, new Map());
    expect(turn.messages[0].content).toContain(`never state until I ask: ${QUESTION.expected}`);
    expect(turn.messages[0].content).toContain('"Hint 1" to "Hint 4"');
    expect(turn.messages[0].content).toContain('"Just tell me"');
    expect(turn.messages[0].content).toContain("marked by a separate grader");
    expect(turn.messages[1]).toMatchObject({ role: "assistant", content: QUESTION.question });
  });
});

describe("grading the reader's answer", () => {
  it("keeps the verdict, the score, the gap and the hints used on the thread", async () => {
    const dir = await tmp();
    const { id } = await startStudy(book, { selection }, "claude", writer(), dir);
    await updateBookState(
      book.id,
      (state) => ({
        ...state,
        threads: state.threads.map((t) => ({ ...t, sessionId: "s1", messages: [...t.messages, { role: "user", content: "Hint 1", createdAt: "" }, { role: "assistant", content: "Look at the second sentence.", createdAt: "" }] })),
      }),
      dir,
    );
    const seen: TutorTurn[] = [];
    const thread = await answerStudy(book.id, id, "  It is smaller.  ", grader("no", 0.9, seen), signal, dir);
    expect(thread.study.turns).toEqual([
      {
        at: expect.any(String),
        answer: "It is smaller.",
        verdict: "wrong",
        score: 0,
        unsure: false,
        gap: { point: "The Sun is much farther away than the Moon.", span: "because it is so much farther away", note: "The answer doesn't say the Sun is farther away." },
        hintsUsed: 1,
        override: null,
      },
    ]);
    expect(thread.study.rubric).toEqual(["The Sun is much farther away than the Moon."]);
    expect(thread.messages.slice(-2).map((message) => [message.role, message.content])).toEqual([
      ["user", "It is smaller."],
      ["assistant", "Graded: not right. The answer doesn't say the Sun is farther away.\n\n> because it is so much farther away"],
    ]);
    /* The tutor's own session never saw the answer or its grade, so the next tutor turn replays the thread. */
    expect(thread.sessionId).toBeNull();
    /* The rubric call is given the expected answer and the passage, and never the reader's answer. */
    expect(seen[0].messages[0].content).toContain(QUESTION.expected);
    expect(seen[0].messages[0].content).not.toContain("It is smaller.");
    expect((await readBookState(book.id, dir)).threads[0]).toEqual(thread);
  });

  it("reports a middling answer as unsure, and marks a second try against the same rubric", async () => {
    const dir = await tmp();
    const { id } = await startStudy(book, { selection }, "claude", writer(), dir);
    const first = await answerStudy(book.id, id, "Something about distance?", grader("partly", 0.9), signal, dir);
    expect(first.study.turns[0]).toMatchObject({ verdict: "partly", score: 0.5, unsure: true });
    expect(standing(first.study.turns[0])).toBe("unsure");
    expect(first.messages.at(-1)?.content).toMatch(/^Graded: unsure\./);
    const seen: TutorTurn[] = [];
    const second = await answerStudy(book.id, id, "The Sun is much farther away.", grader("yes", 0.95, seen), signal, dir);
    expect(seen).toHaveLength(1);
    expect(second.study.turns.map((turn) => turn.verdict)).toEqual(["partly", "right"]);
    expect(second.study.turns[1]).toMatchObject({ score: 1, unsure: false, gap: null });
    expect(second.messages.at(-1)?.content).toBe("Graded: right.");
  });

  it("grades an explain-back against the passage itself", async () => {
    const dir = await tmp();
    await save(dir, asked());
    const { id } = await startStudy(book, { selection }, "claude", writer(), dir);
    const seen: TutorTurn[] = [];
    await answerStudy(book.id, id, "The Moon does most of it.", grader("yes", 0.9, seen), signal, dir);
    expect(seen[0].messages[0].content).toContain(`<expected_answer>\n${PASSAGE}\n</expected_answer>`);
  });

  it("saves nothing when the grader fails or the answer is empty", async () => {
    const dir = await tmp();
    const { id } = await startStudy(book, { selection }, "claude", writer(), dir);
    const broken = { model: "check", provider: scripted(() => "not json") };
    await expect(answerStudy(book.id, id, "An answer.", broken, signal, dir)).rejects.toThrow("couldn't be read");
    await expect(answerStudy(book.id, id, "   ", grader("yes", 0.9), signal, dir)).rejects.toBeInstanceOf(StudyError);
    await expect(answerStudy(book.id, "gone", "An answer.", grader("yes", 0.9), signal, dir)).rejects.toBeInstanceOf(StudyError);
    const [saved] = (await readBookState(book.id, dir)).threads;
    expect(isStudy(saved) && saved.study.turns).toEqual([]);
    expect(saved.messages).toHaveLength(2);
  });

  it("lets the reader overrule a grade and take that back", async () => {
    const dir = await tmp();
    const { id } = await startStudy(book, { selection }, "claude", writer(), dir);
    const graded = await answerStudy(book.id, id, "It is smaller.", grader("no", 0.9), signal, dir);
    const { at } = graded.study.turns[0];
    const overruled = await overruleStudy(book.id, id, at, "right", dir);
    expect(overruled.study.turns[0]).toMatchObject({ verdict: "wrong", override: "right" });
    expect(standing(overruled.study.turns[0])).toBe("right");
    expect((await overruleStudy(book.id, id, at, null, dir)).study.turns[0].override).toBeNull();
  });

  it("keeps an unfinished answer, and clears it once one is graded", async () => {
    const dir = await tmp();
    const { id } = await startStudy(book, { selection }, "claude", writer(), dir);
    expect((await saveStudyDraft(book.id, id, "Because the", dir)).study.draft).toBe("Because the");
    expect((await answerStudy(book.id, id, "Because the Sun is far.", grader("yes", 0.9), signal, dir)).study.draft).toBe("");
  });
});

describe("where a study stands", () => {
  const turn = (overrides: Partial<LearnerTurn>): LearnerTurn => ({ at: "", answer: "", verdict: "right", score: 1, unsure: false, gap: null, hintsUsed: 0, override: null, ...overrides });

  it("counts hints and notices Just tell me", async () => {
    const dir = await tmp();
    const thread = await startStudy(book, { selection }, "claude", writer(), dir);
    expect(studyState(thread)).toEqual({ hintsUsed: 0, hintsLeft: 4, told: false });
    const later = { ...thread, messages: [...thread.messages, { role: "user" as const, content: "Hint 1", createdAt: "" }, { role: "user" as const, content: "Just tell me.", createdAt: "" }] };
    expect(studyState(later)).toEqual({ hintsUsed: 1, hintsLeft: 3, told: true });
  });

  it("never takes a typed answer for a button press, whatever it says", async () => {
    const dir = await tmp();
    const { id } = await startStudy(book, { selection }, "claude", writer(), dir);
    await answerStudy(book.id, id, "Just tell me, is it the distance?", grader("partly", 0.9), signal, dir);
    const thread = await answerStudy(book.id, id, "Hint 2 would help, but: the Sun is far away.", grader("yes", 0.9), signal, dir);
    expect(studyState(thread)).toEqual({ hintsUsed: 0, hintsLeft: 4, told: false });
    expect(hintsGiven(thread)).toEqual([]);
    expect(toldAnswer(thread)).toBeNull();
    expect(thread.study.turns.map((turn) => turn.hintsUsed)).toEqual([0, 0]);
  });

  it("puts the reader's call over the grader's, and says unsure for a grade the grader won't stand behind", () => {
    expect(standing(turn({ verdict: "wrong", score: 0 }))).toBe("wrong");
    expect(standing(turn({ verdict: "right", unsure: true }))).toBe("unsure");
    expect(standing(turn({ verdict: "partly", unsure: true, override: "wrong" }))).toBe("wrong");
    expect(gradeNote(turn({ verdict: "right", unsure: true }))).toBe("Graded: unsure.");
  });
});

describe("the learner ledger", () => {
  it("gets one check per graded answer, a weak one for an unsure grade, and the reader's own call as another", async () => {
    const { ledgerIdle, readLedger } = await import("@/lib/server/ledger");
    const { evidenceStrength } = await import("@/lib/shared/ledger");
    const dir = await tmp();
    const { id } = await startStudy(book, { selection }, "claude", writer(), dir);
    const first = await answerStudy(book.id, id, "Something about distance?", grader("partly", 0.9), signal, dir);
    await overruleStudy(book.id, id, first.study.turns[0].at, "right", dir);
    await ledgerIdle();
    const checks = (await readLedger(dir)).filter((event) => event.outcome !== null);
    expect(checks.map((event) => [event.source, event.outcome, evidenceStrength(event)])).toEqual([
      ["ask", 0.5, "weak"],
      ["ask", 1, "weak"],
    ]);
    /* Both are about the passage, so they join the item its cards and highlights are on. */
    expect(new Set(checks.map((event) => event.item)).size).toBe(1);
  });
});
