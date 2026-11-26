import { MAX_ANSWER, type LearnerTurn } from "@/lib/shared/study";
import type { BookId } from "@/lib/shared/types";
import { gradeAnswer } from "../check/grade";
import type { Checker } from "../check/provider";
import { getConfig } from "../config";
import { bookText } from "../search/index";
import { readBookState, updateBookState } from "../store";
import { shortText } from "../validate";
import { questionPassage } from "./generate";

/** Something the request got wrong: the route answers 400 with the message. */
export class QuizGradeError extends Error {}

/**
 * The text a question's written answer is graded against: the block the question cites with the block either side,
 * as it was checked against when it was written. The stored quote, the start of that block, when the book's text
 * can't be read or the block is no longer there.
 */
const passageOf = async (bookId: BookId, question: { anchor: unknown; quote: string }, dataDir: string): Promise<string> => {
  const text = await bookText(bookId, { extract: true, dataDir }).catch(() => null);
  const wanted = JSON.stringify(question.anchor);
  const index = text ? text.blocks.findIndex((block) => JSON.stringify(block.anchor) === wanted) : -1;
  return text && index >= 0 ? questionPassage(text.blocks, index + 1) : question.quote;
};

/**
 * Grades a written answer to one quiz question, on the checking model, and gives it back as a turn for the test to
 * keep with the answer. Nothing about the answer is saved here; the sitting is saved whole when it ends. The rubric
 * of the first grade is kept on the question, so later answers are marked against the same points with one call.
 */
export const gradeQuizAnswer = async (bookId: BookId, chapter: string, questionId: unknown, answer: unknown, checker: Checker, signal: AbortSignal, dataDir = getConfig().dataDir): Promise<LearnerTurn> => {
  const text = shortText(answer, MAX_ANSWER);
  if (!text) throw new QuizGradeError("Write an answer first.");
  const question = (await readBookState(bookId, dataDir)).quizzes.find((quiz) => quiz.chapter === chapter)?.questions.find((q) => q.id === questionId);
  if (!question) throw new QuizGradeError("That question is no longer in the quiz.");
  const passage = await passageOf(bookId, question, dataDir);
  const grade = await gradeAnswer(checker.provider, { question: question.question, passage, answer: text, expected: question.answer, rubric: question.rubric }, checker.model, signal);
  if (!question.rubric) {
    await updateBookState(
      bookId,
      (state) => ({
        ...state,
        quizzes: state.quizzes.map((quiz) =>
          quiz.chapter === chapter ? { ...quiz, questions: quiz.questions.map((q) => (q.id === questionId && !q.rubric ? { ...q, rubric: grade.rubric } : q)) } : quiz,
        ),
      }),
      dataDir,
    );
  }
  return { at: new Date().toISOString(), answer: text, verdict: grade.verdict, score: grade.score, unsure: grade.unsure, gap: grade.gap, hintsUsed: 0, override: null };
};
