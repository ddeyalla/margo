import { noteEvidence } from "@/lib/server/ledger";
import { startQuiz, quizJobs } from "@/lib/server/quiz/jobs";
import { readBookState, updateBookState } from "@/lib/server/store";
import { isProviderId } from "@/lib/server/tutor/providers";
import { isObject, shortText } from "@/lib/server/validate";
import { readBody, withBook } from "@/lib/server/with-book";
import { cleanStance, isConfidence } from "@/lib/shared/confidence";
import { evidenceOf } from "@/lib/shared/ledger";
import { scoreAttempt, type QuizAnswer } from "@/lib/shared/quiz";

const badRequest = (error: string) => Response.json({ error }, { status: 400 });

/** The book's quizzes, which chapters are being written, and which failed. */
export const GET = withBook(async ({ book }) => {
  const state = await readBookState(book.id);
  return Response.json({ quizzes: state.quizzes, ...quizJobs(book.id) });
});

const parseAnswers = (value: unknown): QuizAnswer[] | null => {
  if (!Array.isArray(value) || value.length > 20) return null;
  const answers: QuizAnswer[] = [];
  for (const item of value) {
    if (!isObject(item) || typeof item.questionId !== "string" || typeof item.correct !== "boolean") return null;
    const confidence = item.confidence ?? null;
    const thinking = item.thinking ?? null;
    if ((confidence !== null && !isConfidence(confidence)) || (thinking !== null && typeof thinking !== "string")) return null;
    answers.push({ questionId: item.questionId, correct: item.correct, ...cleanStance(confidence, thinking) });
  }
  return answers;
};

/**
 * `{ op: "write", chapter, labels, provider }` starts writing a chapter's quiz in the background and answers at
 * once. `{ op: "attempt", chapter, answers }` records a finished attempt. Both answer with the quizzes and jobs.
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
    const state = await readBookState(book.id);
    return Response.json({ quizzes: state.quizzes, ...quizJobs(book.id) }, { status: 202 });
  }

  if (body.op === "attempt") {
    const answers = parseAnswers(body.answers);
    if (!answers) return badRequest("Expected answers: [{ questionId, correct, confidence?, thinking? }].");
    let found = false;
    const saved = await updateBookState(book.id, (state) => ({
      ...state,
      quizzes: state.quizzes.map((quiz) => {
        if (quiz.chapter !== chapter) return quiz;
        found = true;
        return { ...quiz, attempts: [...quiz.attempts, scoreAttempt(quiz, answers, new Date())] };
      }),
    }));
    if (!found) return Response.json({ error: "That chapter has no quiz." }, { status: 404 });
    noteEvidence(evidenceOf(book.id, saved));
    return Response.json({ quizzes: saved.quizzes, ...quizJobs(book.id) });
  }
  return badRequest('op is "write" or "attempt".');
});
