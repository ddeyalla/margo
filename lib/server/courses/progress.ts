import { courseSteps, type Course, type CourseContext } from "@/lib/shared/courses";
import { courseMastery, type BookEvidence, type Mastery } from "@/lib/shared/mastery";
import { isPassed, stepKey } from "@/lib/shared/quiz";
import type { BookId } from "@/lib/shared/types";
import { readBookState } from "../store";
import { quizJobs } from "../quiz/jobs";
import { readCourses } from "./store";

/** How far into each library book of the Course the reader is, from 0 to 1, or null if they never opened it. */
export const readingProgress = async (course: Course): Promise<Map<BookId, number | null>> => {
  const ids = [...new Set(course.books.flatMap((book) => (book.bookId ? [book.bookId] : [])))];
  const states = await Promise.all(ids.map((id) => readBookState(id).catch(() => null)));
  return new Map(ids.map((id, i) => [id, states[i]?.position?.fraction ?? null]));
};

/** What is known of each step's quiz, by `stepKey`: written, passed, being written. */
export interface StepQuiz {
  written: boolean;
  passed: boolean;
  writing: boolean;
}

/** Each step of the Course with its quiz's state, by `stepKey`. */
export const stepQuizzes = async (course: Pick<Course, "books" | "units">): Promise<Map<string, StepQuiz>> => {
  const steps = courseSteps(course);
  const ids = [...new Set(steps.map((step) => step.bookId))];
  const states = new Map(await Promise.all(ids.map(async (id) => [id, await readBookState(id).catch(() => null)] as const)));
  return new Map(
    steps.map((step) => {
      const quiz = states.get(step.bookId)?.quizzes.find((q) => q.chapter === step.chapter);
      return [stepKey(step.bookId, step.chapter), { written: !!quiz, passed: isPassed(quiz), writing: quizJobs(step.bookId).writing.includes(step.chapter) }];
    }),
  );
};

/** Every passed step of the Course, as `stepKey`s. */
export const passedSteps = async (course: Pick<Course, "books" | "units">): Promise<Set<string>> =>
  new Set([...(await stepQuizzes(course))].filter(([, quiz]) => quiz.passed).map(([key]) => key));

/** The Courses that read this book, for its page. */
export const coursesForBook = async (bookId: BookId): Promise<CourseContext[]> => {
  const { courses } = await readCourses().catch(() => ({ courses: [] as Course[] }));
  const reading = courses.filter((course) => courseSteps(course).some((step) => step.bookId === bookId));
  return Promise.all(reading.map(async (course) => ({ id: course.id, name: course.name, steps: courseSteps(course), passed: [...(await passedSteps(course))] })));
};

/** Coverage and retention of a Course as of `now`, read from its books' cards, quizzes and whiteboards. */
export const masteryOf = async (course: Pick<Course, "books" | "units">, now = new Date()): Promise<Mastery> => {
  const ids = [...new Set(courseSteps(course).map((step) => step.bookId))];
  const states = await Promise.all(ids.map((id) => readBookState(id).catch(() => null)));
  const books = new Map<BookId, BookEvidence>();
  ids.forEach((id, i) => {
    const state = states[i];
    if (state) books.set(id, { cardSets: state.cardSets, quizzes: state.quizzes, boards: state.boards });
  });
  return courseMastery(course, books, now);
};
