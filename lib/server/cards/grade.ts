import { MAX_ANSWER } from "@/lib/shared/study";
import type { BookId, Rating } from "@/lib/shared/types";
import { gradeAnswer, type Grade } from "../check/grade";
import type { Checker } from "../check/provider";
import { getConfig } from "../config";
import { readBookState, updateBookState } from "../store";
import { shortText } from "../validate";

/** Something the request got wrong: the route answers 400 with the message. */
export class CardGradeError extends Error {}

/** The grade of a written answer to a free item, and the rating it points to. `suggested` is null when the grader isn't sure: the reader decides. */
export interface CardGrade {
  verdict: Grade["verdict"];
  score: number;
  unsure: boolean;
  gap: Grade["gap"];
  suggested: Rating | null;
}

const SUGGESTED: Record<Grade["verdict"], Rating> = { right: "good", partly: "hard", wrong: "again" };

/**
 * Grades a written answer to one free item against the passage the item's set keeps, on the checking model. Nothing
 * is rated here: the reader sees the grade and rates the item themselves, and their rating is what schedules it.
 * The rubric of the first grade is kept on the item, so later answers are marked against the same points.
 */
export const gradeCardAnswer = async (
  bookId: BookId,
  setId: unknown,
  cueId: unknown,
  answer: unknown,
  checker: Checker,
  signal: AbortSignal,
  dataDir = getConfig().dataDir,
): Promise<CardGrade> => {
  const text = shortText(answer, MAX_ANSWER);
  if (!text) throw new CardGradeError("Write an answer first.");
  const set = (await readBookState(bookId, dataDir)).cardSets.find((candidate) => candidate.id === setId);
  const cue = set?.cues.find((candidate) => candidate.id === cueId);
  if (!set || !cue) throw new CardGradeError("That card is no longer in the book.");
  const grade = await gradeAnswer(checker.provider, { question: cue.question, passage: set.quote, answer: text, expected: cue.answer, rubric: cue.rubric }, checker.model, signal);
  if (!cue.rubric) {
    await updateBookState(
      bookId,
      (state) => ({
        ...state,
        cardSets: state.cardSets.map((candidate) =>
          candidate.id === set.id ? { ...candidate, cues: candidate.cues.map((entry) => (entry.id === cue.id && !entry.rubric && entry.answer === cue.answer ? { ...entry, rubric: grade.rubric } : entry)) } : candidate,
        ),
      }),
      dataDir,
    );
  }
  return { verdict: grade.verdict, score: grade.score, unsure: grade.unsure, gap: grade.gap, suggested: grade.unsure ? null : SUGGESTED[grade.verdict] };
};
