import { describe, expect, it } from "vitest";
import { cardPassage, verifyCards } from "@/lib/server/cards/generate";
import { gradeAnswer, gradeOf, GRADE_SYSTEM, parseGradeReply, parseRubricReply, RUBRIC_SYSTEM } from "@/lib/server/check/grade";
import { inPassage } from "@/lib/server/check/reply";
import { ANSWER_SYSTEM, COMPARE_SYSTEM, isVerified, parseAnswerReply, parseCompareReply, verifyItem } from "@/lib/server/check/verify";
import { checkedQuestions, QUIZ_SYSTEM, questionPassage } from "@/lib/server/quiz/generate";
import { runTool } from "@/lib/server/tools/tool";
import { gradeAnswerTool } from "@/lib/server/tools/grade";
import { ToolError } from "@/lib/server/tools/schema";
import { verifyItemTool } from "@/lib/server/tools/verify";
import type { Provider, TutorEvent, TutorTurn } from "@/lib/server/tutor/types";
import { addCards, changeCards } from "@/lib/shared/cards";
import { parseQuizReply } from "@/lib/shared/quiz";
import type { BookState } from "@/lib/shared/types";
import gradeSet from "./eval/grade-answers.json";
import verifySet from "./eval/verify-items.json";

const signal = new AbortController().signal;

/** A tutor whose every reply comes from `reply`, which sees the whole request. Keeps each request it was sent. */
const scripted = (reply: (turn: TutorTurn) => string, seen: TutorTurn[] = []): Provider => ({
  id: "api",
  label: "Scripted",
  probe: async () => ({ status: "ready", detail: null, version: null }),
  async *run(turn): AsyncGenerator<TutorEvent> {
    seen.push(turn);
    yield { type: "text", delta: reply(turn) };
  },
});

const last = (turn: TutorTurn) => turn.messages.at(-1)!.content;
const json = (value: unknown) => JSON.stringify(value);

const PASSAGE = "The tide is raised mostly by the Moon. The Sun's pull on the oceans is a little under half as strong, because it is so much farther away.";
const ITEM = { question: "What raises most of the ocean tide?", expected: "The Moon's pull.", passage: PASSAGE };

describe("a quote from the passage", () => {
  it("matches word for word, whatever the case, spacing and punctuation", () => {
    expect(inPassage(PASSAGE, "the sun’s pull on the oceans  is a little under half as strong")).toBe(true);
    expect(inPassage(PASSAGE, "The tide is raised mostly by the Moon")).toBe(true);
  });
  it("doesn't match a paraphrase, a part of a word, or nothing", () => {
    expect(inPassage(PASSAGE, "The Sun pulls half as hard")).toBe(false);
    expect(inPassage(PASSAGE, "he tide is raised")).toBe(false);
    expect(inPassage(PASSAGE, " … ")).toBe(false);
  });
});

describe("reading the check's replies", () => {
  it("takes an answer with evidence from the passage", () => {
    expect(parseAnswerReply('```json\n{"answerable": true, "answer": "The Moon.", "evidence": "The tide is raised mostly by the Moon."}\n```', PASSAGE)).toEqual({
      answerable: true,
      answer: "The Moon.",
      evidence: "The tide is raised mostly by the Moon.",
    });
  });
  it("takes 'not answerable' with or without a reason", () => {
    expect(parseAnswerReply('{"answerable": false, "reason": "No depth is given."}', PASSAGE)).toEqual({ answerable: false, reason: "No depth is given." });
    expect(parseAnswerReply('{"answerable": false}', PASSAGE)).toMatchObject({ answerable: false });
  });
  it("sends back an answer whose evidence isn't in the passage, or that is missing a part", () => {
    expect(parseAnswerReply('{"answerable": true, "answer": "Gravity.", "evidence": "Newton showed gravity moves the sea."}', PASSAGE)).toMatch(/word for word/);
    expect(parseAnswerReply('{"answerable": true, "answer": "The Moon."}', PASSAGE)).toMatch(/"answer" and "evidence"/);
    expect(parseAnswerReply('{"answerable": "yes"}', PASSAGE)).toMatch(/true or false/);
    expect(parseAnswerReply("I think it is the Moon.", PASSAGE)).toMatch(/no JSON object/);
    expect(parseAnswerReply('{"answerable": tru}', PASSAGE)).toMatch(/did not parse/);
  });
  it("reads the comparison, and wants both decisions and a reason", () => {
    expect(parseCompareReply('{"matches": true, "supported": false, "reason": "The passage gives no number."}')).toEqual({ matches: true, supported: false, reason: "The passage gives no number." });
    expect(parseCompareReply('{"matches": "true", "supported": false, "reason": "x"}')).toMatch(/true or false/);
    expect(parseCompareReply('{"matches": true, "supported": true}')).toMatch(/"reason"/);
  });
});

/** A checker that answers every question with `answer` and compares as `verdict` says. */
const checker = (answer: string | null, verdict = { matches: true, supported: true, reason: "They agree." }, seen: TutorTurn[] = []) =>
  scripted((turn) => {
    if (turn.system === ANSWER_SYSTEM) return answer ? json({ answerable: true, answer, evidence: "The tide is raised mostly by the Moon" }) : json({ answerable: false, reason: "The passage doesn't say." });
    if (turn.system === COMPARE_SYSTEM) return json(verdict);
    throw new Error("unexpected prompt");
  }, seen);

describe("verifyItem", () => {
  it("answers from the passage without the stored answer, then compares in a second conversation", async () => {
    const seen: TutorTurn[] = [];
    const result = await verifyItem(checker("The Moon.", undefined, seen), { ...ITEM, expected: "The pull of Luna, our satellite." }, "cheap", signal);
    expect(result).toEqual({ answerable: true, matches: true, supported: true, reason: "They agree.", answer: "The Moon." });
    expect(isVerified(result)).toBe(true);
    expect(seen.map((turn) => turn.system)).toEqual([ANSWER_SYSTEM, COMPARE_SYSTEM]);
    expect(seen.every((turn) => turn.sessionId === null && turn.model === "cheap" && turn.messages.length === 1)).toBe(true);
    expect(last(seen[0])).toContain(PASSAGE);
    expect(last(seen[0])).toContain(ITEM.question);
    expect(last(seen[0])).not.toContain("Luna");
    expect(last(seen[1])).toContain("Luna");
    expect(last(seen[1])).toContain("The Moon.");
  });

  it("stops after one call when the passage can't answer the question", async () => {
    const seen: TutorTurn[] = [];
    const result = await verifyItem(checker(null, undefined, seen), ITEM, null, signal);
    expect(result).toEqual({ answerable: false, matches: false, supported: false, reason: "The passage doesn't say.", answer: null });
    expect(isVerified(result)).toBe(false);
    expect(seen).toHaveLength(1);
  });

  it("fails an item whose answers differ, or whose stored answer the passage doesn't back", async () => {
    expect(isVerified(await verifyItem(checker("The Moon.", { matches: false, supported: true, reason: "One says the Sun." }), ITEM, null, signal))).toBe(false);
    expect(isVerified(await verifyItem(checker("The Moon.", { matches: true, supported: false, reason: "No number in the passage." }), ITEM, null, signal))).toBe(false);
  });

  it("sends a reply it can't read back once with the reason, and gives up on a second", async () => {
    const seen: TutorTurn[] = [];
    let tries = 0;
    const flaky = scripted((turn) => {
      if (turn.system === COMPARE_SYSTEM) return json({ matches: true, supported: true, reason: "Same." });
      return tries++ ? json({ answerable: true, answer: "The Moon.", evidence: "raised mostly by the Moon" }) : "The Moon, clearly.";
    }, seen);
    expect(isVerified(await verifyItem(flaky, ITEM, null, signal))).toBe(true);
    expect(seen[1].messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(last(seen[1])).toMatch(/couldn't be used. The reply had no JSON object\./);
    await expect(verifyItem(scripted(() => "no"), ITEM, null, signal)).rejects.toThrow(/The check's answer couldn't be read/);
  });
});

describe("reading the grader's replies", () => {
  it("reads one to four rubric points", () => {
    expect(parseRubricReply('{"points": ["The Moon raises most of the tide."]}')).toEqual({ points: ["The Moon raises most of the tide."] });
    expect(parseRubricReply('{"points": []}')).toMatch(/one to 4/);
    expect(parseRubricReply('{"points": ["a", "b", "c", "d", "e"]}')).toMatch(/one to 4/);
    expect(parseRubricReply('{"points": ["a", 2]}')).toMatch(/short sentence/);
  });
  it("wants one mark per point, a confidence, and a gap from the passage for anything missed", () => {
    expect(parseGradeReply('{"marks": ["yes", "yes"], "confidence": 0.9, "gap": null}', 2, PASSAGE)).toEqual({ marks: ["yes", "yes"], confidence: 0.9, gap: null });
    expect(parseGradeReply('{"marks": ["yes", "no"], "confidence": 0.9, "gap": {"span": "a little under half as strong", "note": "The answer gives no size for the Sun\'s pull."}}', 2, PASSAGE)).toMatchObject({
      gap: { span: "a little under half as strong" },
    });
    expect(parseGradeReply('{"marks": ["yes"], "confidence": 0.9}', 2, PASSAGE)).toMatch(/exactly 2 marks/);
    expect(parseGradeReply('{"marks": ["yes", "maybe"], "confidence": 0.9}', 2, PASSAGE)).toMatch(/"yes", "partly" or "no"/);
    expect(parseGradeReply('{"marks": ["yes", "yes"], "confidence": 90}', 2, PASSAGE)).toMatch(/0 to 1/);
    expect(parseGradeReply('{"marks": ["no", "yes"], "confidence": 0.9, "gap": null}', 2, PASSAGE)).toMatch(/needs a "gap"/);
    expect(parseGradeReply('{"marks": ["no", "yes"], "confidence": 0.9, "gap": {"span": "the Sun is far", "note": "x"}}', 2, PASSAGE)).toMatch(/word for word/);
  });
});

describe("the grade the marks add up to", () => {
  const grade = (marks: ("yes" | "partly" | "no")[], confidence = 0.9) =>
    gradeOf(marks.map((_, i) => `point ${i + 1}`), { marks, confidence, gap: marks.every((mark) => mark === "yes") ? null : { span: "s", note: "n" } });

  it("is right only when the points are made, wrong only when none is made even in part, and unsure in between", () => {
    expect(grade(["yes"])).toMatchObject({ score: 1, verdict: "right", unsure: false, gap: null });
    expect(grade(["no"])).toMatchObject({ score: 0, verdict: "wrong", unsure: false });
    expect(grade(["partly"])).toMatchObject({ score: 0.5, verdict: "partly", unsure: true });
    expect(grade(["yes", "no"])).toMatchObject({ score: 0.5, verdict: "partly", unsure: true });
    expect(grade(["yes", "partly"])).toMatchObject({ score: 0.75, verdict: "partly", unsure: true });
    expect(grade(["partly", "no"])).toMatchObject({ score: 0.25, verdict: "partly", unsure: true });
    expect(grade(["no", "no", "no", "partly"])).toMatchObject({ score: 0.13, verdict: "partly", unsure: true });
    expect(grade(["no", "no"])).toMatchObject({ score: 0, verdict: "wrong", unsure: false });
    expect(grade(["yes", "yes", "yes", "partly"])).toMatchObject({ score: 0.88, verdict: "right", unsure: false });
  });
  it("is unsure whenever the grader's confidence is low, whatever the verdict", () => {
    expect(grade(["yes"], 0.6)).toMatchObject({ verdict: "right", unsure: true });
    expect(grade(["no"], 0.69)).toMatchObject({ verdict: "wrong", unsure: true });
    expect(grade(["no"], 0.7)).toMatchObject({ verdict: "wrong", unsure: false });
  });
  it("names the first point that wasn't fully made", () => {
    expect(grade(["yes", "partly", "no"]).gap).toEqual({ point: "point 2", span: "s", note: "n" });
  });
});

describe("gradeAnswer", () => {
  const grader = (seen: TutorTurn[]) =>
    scripted((turn) => {
      if (turn.system === RUBRIC_SYSTEM) return json({ points: ["The Moon raises most of the tide.", "The Sun's pull is weaker because it is farther away."] });
      if (turn.system === GRADE_SYSTEM) return json({ marks: ["yes", "no"], confidence: 0.9, gap: { span: "because it is so much farther away", note: "The answer doesn't say why the Sun's pull is weaker." } });
      throw new Error("unexpected prompt");
    }, seen);
  const input = { question: "What raises the tide, and why does the Sun matter less?", expected: "Mostly the Moon; the Sun is farther so pulls less.", passage: PASSAGE, answer: "The Moon does, the Sun is irrelevant zzz." };

  it("fixes the rubric in a call that never sees the reader's answer, then marks against it", async () => {
    const seen: TutorTurn[] = [];
    const grade = await gradeAnswer(grader(seen), input, "cheap", signal);
    expect(grade).toMatchObject({ score: 0.5, verdict: "partly", unsure: true, marks: ["yes", "no"] });
    expect(grade.gap).toEqual({ point: "The Sun's pull is weaker because it is farther away.", span: "because it is so much farther away", note: "The answer doesn't say why the Sun's pull is weaker." });
    expect(seen.map((turn) => turn.system)).toEqual([RUBRIC_SYSTEM, GRADE_SYSTEM]);
    expect(last(seen[0])).not.toContain("zzz");
    expect(last(seen[0])).toContain(input.expected);
    expect(last(seen[1])).toContain("zzz");
    expect(last(seen[1])).toContain("2. The Sun's pull is weaker");
    expect(last(seen[1])).not.toContain(input.expected);
  });

  it("skips the rubric call when the caller kept the rubric", async () => {
    const seen: TutorTurn[] = [];
    const grade = await gradeAnswer(grader(seen), { ...input, expected: undefined, rubric: ["a", "b"] }, null, signal);
    expect(seen.map((turn) => turn.system)).toEqual([GRADE_SYSTEM]);
    expect(grade.rubric).toEqual(["a", "b"]);
  });
});

describe("a quiz is checked before it is saved", () => {
  const blocks = Array.from({ length: 6 }, (_, i) => ({ text: `Block ${i + 1} says fact ${i + 1} is true because of cause ${i + 1}.` }));
  const question = (n: number, tag = "") => ({ kind: n === 1 ? "why" : "recall", question: `What does block ${n} say${tag}?`, answer: `Fact ${n} is true.`, block: n });
  const book = { title: "Facts", author: null };

  /** Writes `first` as the quiz and `second` as the replacements; the check fails any question whose text holds "BAD". */
  const tutor = (first: unknown[], second: unknown[], seen: TutorTurn[] = []) =>
    scripted((turn) => {
      if (turn.system === QUIZ_SYSTEM) return json({ questions: last(turn).includes("Don't ask them again") ? second : first });
      if (turn.system === ANSWER_SYSTEM) return last(turn).includes("BAD") ? json({ answerable: false, reason: "The block doesn't say." }) : json({ answerable: true, answer: "It is true.", evidence: "is true because of cause" });
      return json({ matches: true, supported: true, reason: "Same." });
    }, seen);

  it("keeps a quiz whose questions all pass, without asking for more", async () => {
    const seen: TutorTurn[] = [];
    const kept = await checkedQuestions(tutor([1, 2, 3, 4, 5].map((n) => question(n)), [], seen), { book, chapter: "One", blocks }, { model: "big", checkModel: "cheap" }, signal);
    expect(kept.map((q) => q.block)).toEqual([1, 2, 3, 4, 5]);
    expect(seen.filter((turn) => turn.system === QUIZ_SYSTEM)).toHaveLength(1);
    expect(seen.filter((turn) => turn.system === QUIZ_SYSTEM).every((turn) => turn.model === "big")).toBe(true);
    expect(seen.filter((turn) => turn.system !== QUIZ_SYSTEM).every((turn) => turn.model === "cheap")).toBe(true);
    expect(seen.filter((turn) => turn.system === ANSWER_SYSTEM)).toHaveLength(5);
  });

  it("drops a corrupted question, asks for it again once, and keeps the replacement only if it passes", async () => {
    const seen: TutorTurn[] = [];
    const first = [question(1), question(2), question(3, " BAD"), question(4), question(5, " BAD")];
    const kept = await checkedQuestions(tutor(first, [question(6), question(3, " again BAD")], seen), { book, chapter: "One", blocks }, { model: null, checkModel: null }, signal);
    expect(kept.map((q) => q.question)).toEqual(["What does block 1 say?", "What does block 2 say?", "What does block 4 say?", "What does block 6 say?"]);
    const asks = seen.filter((turn) => turn.system === QUIZ_SYSTEM);
    expect(asks).toHaveLength(2);
    expect(last(asks[1])).toContain("- What does block 3 say BAD? (The block doesn't say.)");
    expect(last(asks[1])).toContain("Write 2 more questions");
  });

  it("checks each question against the block it cites and its neighbours", () => {
    expect(questionPassage(blocks, 1)).toBe(`${blocks[0].text}\n\n${blocks[1].text}`);
    expect(questionPassage(blocks, 3)).toBe(`${blocks[1].text}\n\n${blocks[2].text}\n\n${blocks[3].text}`);
    const long = [{ text: "a".repeat(5_000) }, { text: "b".repeat(5_000) }];
    expect(questionPassage(long, 2)).toBe(long[1].text);
  });

  it("saves nothing when too few questions pass, and says how many did", async () => {
    const first = [question(1), question(2), question(3, " BAD"), question(4, " BAD"), question(5, " BAD")];
    await expect(checkedQuestions(tutor(first, [question(6, " BAD")]), { book, chapter: "One", blocks }, { model: null, checkModel: null }, signal)).rejects.toThrow(
      /Only 2 of the 6 questions written for “One” held up .* no quiz was saved\. The block doesn't say\./,
    );
  });

  it("counts a check that couldn't run as a failed check, not as a pass", async () => {
    const broken = scripted((turn) => {
      if (turn.system === QUIZ_SYSTEM) return json({ questions: [1, 2, 3, 4, 5].map((n) => question(n)) });
      return "not json";
    });
    await expect(checkedQuestions(broken, { book, chapter: "One", blocks }, { model: null, checkModel: null }, signal)).rejects.toThrow(/Only 0 of the 5 .* The check couldn't be run/);
  });

  it("reads a reply of replacement questions without the whole quiz's minimums", () => {
    const reply = json({ questions: [question(2), question(3), question(4)] });
    expect(parseQuizReply(reply, 6)).toMatch(/Write 5 to 8 questions/);
    expect(parseQuizReply(reply, 6, 2)).toHaveLength(2);
    expect(parseQuizReply(json({ questions: [] }), 6, 2)).toMatch(/Write 2 questions; the reply had none/);
  });
});

describe("cards are checked before they are stored", () => {
  const source = { quote: "The tide is raised mostly by the Moon.", before: "Tides.", after: "The Sun's pull is weaker.", chapterTitle: null };
  const now = new Date("2026-11-26T10:00:00.000Z");
  const anchor = { kind: "epub", cfi: "epubcfi(/6/2!/4/2)" } as const;

  it("keeps the cards that pass, stamped with when, and drops the rest with why", async () => {
    const seen: TutorTurn[] = [];
    const provider = scripted((turn) => {
      if (turn.system === ANSWER_SYSTEM) return last(turn).includes("deep") ? json({ answerable: false, reason: "No depth is given." }) : json({ answerable: true, answer: "The Moon.", evidence: "raised mostly by the Moon" });
      return json({ matches: true, supported: true, reason: "Same." });
    }, seen);
    const cards = [
      { question: "What raises most of the tide?", answer: "The Moon." },
      { question: "How deep is the tide?", answer: "Two metres." },
    ];
    const result = await verifyCards({ provider, model: "cheap" }, source, cards, signal, now);
    expect(result.kept).toEqual([{ ...cards[0], verifiedAt: "2026-11-26T10:00:00.000Z" }]);
    expect(result.dropped).toEqual([{ question: "How deep is the tide?", reason: "No depth is given." }]);
    expect(last(seen[0])).toContain(cardPassage(source));
    expect(cardPassage(source)).toBe("Tides.\nThe tide is raised mostly by the Moon.\nThe Sun's pull is weaker.");
  });

  it("stores the mark on the card, and drops it when the reader rewrites the card", () => {
    let id = 0;
    const { sets } = addCards([], { anchor, quote: source.quote, chapterTitle: null, fact: "f", cards: [{ question: "q1", answer: "a1", verifiedAt: now.toISOString() }, { question: "q2", answer: "a2" }] }, now, () => `id${id++}`);
    expect(sets[0].cues.map((cue) => cue.verifiedAt)).toEqual(["2026-11-26T10:00:00.000Z", undefined]);
    expect("verifiedAt" in sets[0].cues[1]).toBe(false);
    const cueId = sets[0].cues[0].id;
    const same = changeCards(sets, { op: "edit-cue", setId: sets[0].id, cueId, question: "q1", answer: "a1" }, now);
    expect(same[0].cues[0].verifiedAt).toBe("2026-11-26T10:00:00.000Z");
    const edited = changeCards(sets, { op: "edit-cue", setId: sets[0].id, cueId, question: "q1", answer: "something else" }, now);
    expect("verifiedAt" in edited[0].cues[0]).toBe(false);
  });

  it("still loads cards and quizzes saved before anything was checked", () => {
    const saved = JSON.parse(
      '{"cardSets":[{"id":"s","cues":[{"id":"c","question":"q","answer":"a","createdAt":"2026-01-01T00:00:00.000Z","lastRating":null}]}],"quizzes":[{"chapter":"One","questions":[{"id":"x","kind":"recall","question":"q","answer":"a","anchor":{"kind":"epub","cfi":"epubcfi(/6/2)"},"quote":"t"}],"createdAt":"2026-01-01T00:00:00.000Z","attempts":[]}]}',
    ) as Pick<BookState, "cardSets" | "quizzes">;
    expect(saved.cardSets[0].cues[0].verifiedAt).toBeUndefined();
    expect(saved.quizzes[0].questions[0].verifiedAt).toBeUndefined();
  });
});

describe("the two tools", () => {
  const context = { caller: "test", now: new Date() };
  it("refuse arguments they can't use before any model runs", async () => {
    await expect(runTool(verifyItemTool, { question: "q", expected: "a" }, context)).rejects.toThrow(/"passage" is required/);
    await expect(runTool(verifyItemTool, { question: "q", expected: "a", passage: "p", provider: "gemini" }, context)).rejects.toThrow(/must be one of: claude, codex, api/);
    await expect(runTool(gradeAnswerTool, { question: "q", answer: "a", passage: "p" }, context)).rejects.toThrow(ToolError);
    await expect(runTool(gradeAnswerTool, { question: "q", answer: "a", passage: "p", rubric: [1] }, context)).rejects.toThrow(/short sentence/);
    await expect(runTool(gradeAnswerTool, { question: "q", answer: "a", passage: "p", rubric: [] }, context)).rejects.toThrow(/"rubric" must list one to 4/);
  });
});

describe("the evaluation set", () => {
  it("has enough labelled items of each kind for the real-model run", () => {
    expect(verifySet.length).toBeGreaterThanOrEqual(12);
    expect(verifySet.filter((item) => !item.verified).length).toBeGreaterThanOrEqual(4);
    expect(verifySet.every((item) => item.id && item.question && item.expected && item.passage && typeof item.verified === "boolean" && item.why)).toBe(true);
    expect(gradeSet.length).toBeGreaterThanOrEqual(12);
    for (const label of ["right", "wrong", "middling"]) expect(gradeSet.filter((item) => item.label === label).length).toBeGreaterThanOrEqual(3);
    expect(gradeSet.filter((item) => "heldOut" in item).length).toBeGreaterThanOrEqual(6);
    expect(gradeSet.every((item) => item.id && item.question && item.expected && item.passage && item.answer)).toBe(true);
    expect(new Set([...verifySet, ...gradeSet].map((item) => item.id)).size).toBe(verifySet.length + gradeSet.length);
  });
});
