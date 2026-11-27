import { sameAnchor } from "./annotations";
import { anchorItem } from "./ledger";
import type { ChapterQuiz, QuizQuestion } from "./quiz";
import { askable } from "./sitting";
import { newSchedule, replaySchedule, studyDay } from "./schedule";
import type { AnswerType, BookState, CardSet, Cue } from "./types";

/*
 * The item bank. Every prompt the reader is brought back to is an item: a `Cue` with an answer type, in the set
 * of its passage, which holds the anchor and the FSRS schedule. Review cards and the questions of chapter
 * quizzes are the same thing here, and one queue (`reviewQueue`) brings both back.
 */

/** How an item is answered, by its type: a card made before types existed is a flip. */
export const typeOf = (cue: Pick<Cue, "type">): AnswerType => cue.type ?? "flip";

/** What the bank holds of a quiz question, once: the key `BookState.banked` remembers it by. */
export const questionKey = (chapter: string, questionId: string) => `${chapter}\n${questionId}`;

/* Both ids are made from what the question is, never drawn fresh, so reading the same book twice before anything
   is written gives the same sets and cues, and a page holding one of them can still name it afterwards. */
const quizCueId = (questionId: string) => `quiz:${questionId}`;
const quizSetId = (anchorKey: string) => {
  let hash = 2166136261;
  for (let i = 0; i < anchorKey.length; i++) hash = Math.imul(hash ^ anchorKey.charCodeAt(i), 16777619);
  return `quiz-set:${(hash >>> 0).toString(36)}`;
};

/** A set made only of chapter-quiz questions. The quizzes already count it in a Course's retention and the streak; the notes copy leaves it out. */
export const isQuizSet = (set: Pick<CardSet, "cues">): boolean => set.cues.length > 0 && set.cues.every((cue) => cue.origin);

/** A quiz question as an item: a recall question is flipped and rated, an explain question is written and graded. */
const cueOf = (quiz: ChapterQuiz, question: QuizQuestion): Cue => {
  const lastAnswer = answersTo(quiz, question.id).at(-1);
  return {
    id: quizCueId(question.id),
    question: question.question,
    answer: question.answer,
    createdAt: quiz.createdAt,
    lastRating: lastAnswer ? (lastAnswer.correct ? "good" : "again") : null,
    ...(question.verifiedAt ? { verifiedAt: question.verifiedAt } : {}),
    type: question.kind === "why" ? "free" : "flip",
    ...(question.rubric ? { rubric: question.rubric } : {}),
    origin: { chapter: quiz.chapter, questionId: question.id },
  };
};

const answersTo = (quiz: ChapterQuiz, questionId: string) =>
  quiz.attempts.flatMap((attempt) => attempt.answers.filter((answer) => answer.questionId === questionId).map((answer) => ({ at: attempt.at, correct: answer.correct })));

/** A new set for questions of one passage. What the quizzes already know of the reader sets its schedule: the replay of their answers. */
const setOf = (quiz: ChapterQuiz, question: QuizQuestion, cues: Cue[]): CardSet => {
  const answers = answersTo(quiz, question.id);
  const schedule = replaySchedule(answers);
  return {
    id: quizSetId(anchorItem(question.anchor)),
    anchor: question.anchor,
    quote: question.quote,
    chapterTitle: quiz.chapter,
    fact: question.answer,
    cues,
    schedule: schedule ?? newSchedule(new Date(quiz.createdAt)),
    learningCueId: null,
    introducedOn: answers.length ? studyDay(new Date(answers[0].at)) : null,
    createdAt: quiz.createdAt,
  };
};

type Banked = Pick<BookState, "cardSets" | "quizzes" | "banked">;

/**
 * Moves the questions of the book's chapter quizzes that the bank doesn't hold yet into it, as items in the set at
 * their passage, or in a new set when the passage has none. A quiz joins once it has been taken: before that its
 * questions are the test's, and the bank would show the reader its answers. A new set's schedule is the replay of
 * every answer to its questions; a question that joins a set the reader already reviews keeps that set's schedule.
 * `banked` lists every question moved, so an item the reader deletes is not made again. Nothing is removed from
 * the quizzes or from the sets: a state with this applied still holds all it did before. Nothing here reads the
 * clock, so the same input gives the same output, and the state's own arrays come back when there is nothing to move.
 */
export const bankQuizzes = (state: Banked): Pick<Banked, "cardSets" | "banked"> => {
  const banked = new Set(state.banked);
  const sets = state.cardSets.map((set) => ({ ...set }));
  const added: string[] = [];
  /* Answers behind each new set's schedule, from every question that joined it. */
  const answered = new Map<CardSet, { at: string; correct: boolean }[]>();
  for (const quiz of state.quizzes) {
    if (!quiz.attempts.length) continue;
    for (const question of askable(quiz)) {
      const key = questionKey(quiz.chapter, question.id);
      if (banked.has(key)) continue;
      added.push(key);
      const cue = cueOf(quiz, question);
      const home = sets.find((set) => sameAnchor(set.anchor, question.anchor));
      if (home) {
        if (!home.cues.some((existing) => existing.id === cue.id)) home.cues = [...home.cues, cue];
        if (answered.has(home)) answered.get(home)!.push(...answersTo(quiz, question.id));
      } else {
        const set = setOf(quiz, question, [cue]);
        sets.push(set);
        answered.set(set, answersTo(quiz, question.id));
      }
    }
  }
  for (const [set, answers] of answered) {
    const sorted = answers.sort((a, b) => a.at.localeCompare(b.at));
    set.schedule = replaySchedule(sorted) ?? set.schedule;
    set.introducedOn = sorted.length ? studyDay(new Date(sorted[0].at)) : null;
  }
  if (!added.length) return { cardSets: state.cardSets, banked: state.banked };
  return { cardSets: sets, banked: [...state.banked, ...added] };
};
