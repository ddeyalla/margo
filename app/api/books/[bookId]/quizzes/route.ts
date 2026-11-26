import { checkerFor } from "@/lib/server/check/provider";
import { gradeQuizAnswer, QuizGradeError } from "@/lib/server/quiz/grade";
import { noteEvidence } from "@/lib/server/ledger";
import { startQuiz, quizJobs } from "@/lib/server/quiz/jobs";
import { BookClosedError, readBookState, updateBookState } from "@/lib/server/store";
import { isProviderId } from "@/lib/server/tutor/providers";
import { isObject, shortText } from "@/lib/server/validate";
import { readBody, withBook } from "@/lib/server/with-book";
import { cleanStance, isConfidence } from "@/lib/shared/confidence";
import { evidenceOf } from "@/lib/shared/ledger";
import type { QuizAnswer } from "@/lib/shared/quiz";
import { recordSitting } from "@/lib/shared/sitting";
import { MAX_ANSWER, standing, type LearnerTurn } from "@/lib/shared/study";
import type { BookState } from "@/lib/shared/types";

const badRequest = (error: string) => Response.json({ error }, { status: 400 });

const answerWith = (state: BookState, bookId: string) => ({ quizzes: state.quizzes, skips: state.quizSkips, ...quizJobs(bookId) });

/** The book's quizzes, the notices passed over, which chapters are being written, and which failed. */
export const GET = withBook(async ({ book }) => Response.json(answerWith(await readBookState(book.id), book.id)));

const VERDICTS = ["right", "partly", "wrong"];

/** A graded answer as the page sends it back with the sitting: what the grade route gave it, with the reader's call. */
const parseTurn = (value: unknown): LearnerTurn | null => {
  if (!isObject(value)) return null;
  const { at, answer, verdict, score, unsure, override } = value;
  const gap = value.gap ?? null;
  if (typeof at !== "string" || typeof answer !== "string" || answer.length > MAX_ANSWER || !VERDICTS.includes(verdict as string)) return null;
  if (typeof score !== "number" || !(score >= 0 && score <= 1) || typeof unsure !== "boolean") return null;
  if (override !== null && override !== "right" && override !== "wrong") return null;
  if (gap !== null && !(isObject(gap) && [gap.point, gap.span, gap.note].every((part) => typeof part === "string" && part.length <= 2_000))) return null;
  return { at, answer, verdict, score, unsure, gap, hintsUsed: 0, override } as LearnerTurn;
};

const parseAnswers = (value: unknown): QuizAnswer[] | null => {
  if (!Array.isArray(value) || value.length > 20) return null;
  const answers: QuizAnswer[] = [];
  for (const item of value) {
    if (!isObject(item) || typeof item.questionId !== "string" || typeof item.correct !== "boolean") return null;
    const confidence = item.confidence ?? null;
    const thinking = item.thinking ?? null;
    if ((confidence !== null && !isConfidence(confidence)) || (thinking !== null && typeof thinking !== "string")) return null;
    const turn = item.turn === undefined ? undefined : parseTurn(item.turn);
    if (turn === null || (item.again !== undefined && typeof item.again !== "boolean")) return null;
    answers.push({
      questionId: item.questionId,
      /* A graded answer counts as it stands once the reader's call is in, whatever the page says. */
      correct: turn ? standing(turn) === "right" : item.correct,
      ...cleanStance(confidence, thinking),
      ...(turn ? { turn } : {}),
      ...(typeof item.again === "boolean" ? { again: item.again } : {}),
    });
  }
  return answers;
};

/**
 * Every answer is the book's quizzes, skips and jobs, except "grade".
 * - `{ op: "write", chapter, labels, provider }` starts writing a chapter's quiz in the background and answers at once.
 * - `{ op: "attempt", chapter, kind, retestOf?, answers }` records a finished test or retest, each answer with the quiz its question is in.
 * - `{ op: "grade", chapter, questionId, answer, provider }` grades a written answer with the checker and answers `{ turn }`. Nothing is saved but the question's rubric.
 * - `{ op: "skip", chapter, retestOf? }` remembers that the reader passed over a chapter's test, or the retest of one test.
 */
export const POST = withBook(async (found) => {
  const { book, request } = found;
  const body = await readBody(request);
  if (!isObject(body)) return badRequest("Expected a JSON object.");
  const chapter = shortText(body.chapter, 500);
  if (!chapter) return badRequest("Expected a chapter.");

  if (body.op === "write") {
    if (!isProviderId(body.provider)) return badRequest("Unknown provider.");
    const labels = Array.isArray(body.labels) ? body.labels.map((label) => shortText(label, 500)).filter((label): label is string => !!label).slice(0, 200) : [chapter];
    await startQuiz(found, chapter, labels.includes(chapter) ? labels : [chapter, ...labels], body.provider);
    return Response.json(answerWith(await readBookState(book.id), book.id), { status: 202 });
  }

  if (body.op === "attempt") {
    const answers = parseAnswers(body.answers);
    if (!answers) return badRequest("Expected answers: [{ questionId, correct, confidence?, thinking?, turn?, again? }].");
    const kind = body.kind === "retest" ? "retest" : "test";
    const retestOf = typeof body.retestOf === "string" ? body.retestOf.slice(0, 40) : undefined;
    let known = false;
    const saved = await updateBookState(book.id, (state) => {
      const quizzes = recordSitting(state.quizzes, { chapter, kind, retestOf, answers }, new Date());
      known = quizzes !== null;
      return quizzes ? { ...state, quizzes } : state;
    });
    if (!known) return Response.json({ error: "That chapter has no quiz." }, { status: 404 });
    noteEvidence(evidenceOf(book.id, saved));
    return Response.json(answerWith(saved, book.id));
  }

  if (body.op === "grade") {
    if (!isProviderId(body.provider)) return badRequest("Unknown provider.");
    try {
      return Response.json({ turn: await gradeQuizAnswer(book.id, chapter, body.questionId, body.answer, checkerFor(body.provider), request.signal) });
    } catch (error) {
      if (error instanceof QuizGradeError) return badRequest(error.message);
      if (error instanceof BookClosedError) throw error;
      if (request.signal.aborted) return new Response(null, { status: 499 });
      return Response.json({ error: error instanceof Error ? error.message : "The answer couldn't be graded." }, { status: 502 });
    }
  }

  if (body.op === "skip") {
    const retestOf = typeof body.retestOf === "string" ? body.retestOf.slice(0, 40) : undefined;
    const saved = await updateBookState(book.id, (state) =>
      state.quizSkips.some((skip) => skip.chapter === chapter && skip.retestOf === retestOf)
        ? state
        : { ...state, quizSkips: [...state.quizSkips, retestOf ? { chapter, retestOf } : { chapter }] },
    );
    return Response.json(answerWith(saved, book.id));
  }
  return badRequest('op is "write", "attempt", "grade" or "skip".');
});
