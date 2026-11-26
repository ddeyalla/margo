"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChapter, type PlaceStore } from "@/components/book/place";
import type { TocEntry } from "@/components/reader/types";
import type { CourseContext } from "@/lib/shared/courses";
import { chapterOf, chapterSpan, isPassed, leftChapter, stepKey, stepStates, type ChapterQuiz, type QuizSkip, type StepState } from "@/lib/shared/quiz";
import { bookChapters, nextRetest, type SittingRecord } from "@/lib/shared/sitting";
import type { LearnerTurn } from "@/lib/shared/study";
import type { BookId, ProviderId } from "@/lib/shared/types";

interface Jobs {
  quizzes: ChapterQuiz[];
  skips: QuizSkip[];
  writing: string[];
  failed: { chapter: string; error: string }[];
}

/** How often to look for a quiz being written. */
const POLL_MS = 4000;

/**
 * How long a chapter outside a Course must have been open before leaving it counts as finishing it. Paging through a
 * book to find a place should not have a quiz written for every chapter passed on the way.
 */
const MIN_READ_MS = 20_000;

const request = (bookId: BookId, body: unknown, signal?: AbortSignal) =>
  fetch(`/api/books/${bookId}/quizzes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });

const post = async (bookId: BookId, body: unknown): Promise<Jobs> => {
  const response = await request(bookId, body);
  const answer = (await response.json().catch(() => null)) as (Jobs & { error?: string }) | null;
  if (!response.ok || !answer?.quizzes) throw new Error(answer?.error ?? `The quiz request failed with ${response.status}.`);
  return answer;
};

/**
 * The book's chapter quizzes. Leaving a chapter for the next one finishes it: its quiz is offered, and written in the
 * background if it has none. In a Course the chapters are the Course's and passing one opens the next; any other
 * chapter of any book gets the same quiz with nothing riding on it, and passing over its notice is remembered.
 */
export function useQuizzes({
  bookId,
  initial,
  initialSkips,
  courses,
  spot,
  toc,
  provider,
}: {
  bookId: BookId;
  initial: ChapterQuiz[];
  initialSkips: QuizSkip[];
  courses: CourseContext[];
  spot: PlaceStore;
  toc: TocEntry[] | null;
  provider: ProviderId | null;
}) {
  const [jobs, setJobs] = useState<Jobs>({ quizzes: initial, skips: initialSkips, writing: [], failed: [] });
  const [error, setError] = useState<string | null>(null);
  /* The chapter just finished, whose quiz the notice offers. */
  const [finished, setFinished] = useState<string | null>(null);
  /* Retests are worked out as of when the book was opened; the page is read again when the reader comes back to it. */
  const [openedAt] = useState(() => new Date());

  /** This book's chapters in any Course, each once. */
  const chapters = useMemo(() => [...new Set(courses.flatMap((course) => course.steps.filter((step) => step.bookId === bookId).map((step) => step.chapter)))], [courses, bookId]);
  /** The book's other chapters, from its own contents. Nothing is gated on these. */
  const ownChapters = useMemo(() => (toc ? bookChapters(toc, chapters) : []), [toc, chapters]);

  /** Each Course's steps with what this page knows: passes elsewhere from the server, and this book's from here. */
  const steps = useMemo(() => {
    const local = new Set(jobs.quizzes.filter(isPassed).map((quiz) => stepKey(bookId, quiz.chapter)));
    return courses.map((course) => {
      const passed = new Set(course.passed.filter((key) => !key.startsWith(`${bookId}\n`)));
      for (const key of local) passed.add(key);
      return { id: course.id, name: course.name, states: stepStates(course.steps, passed) };
    });
  }, [courses, jobs.quizzes, bookId]);

  const send = useCallback(
    async (body: unknown, failure: string) => {
      try {
        setJobs(await post(bookId, body));
        return true;
      } catch (problem) {
        setError(problem instanceof Error ? problem.message : failure);
        return false;
      }
    },
    [bookId],
  );

  const write = useCallback(
    async (chapter: string) => {
      if (!provider) return;
      setError(null);
      const labels = (toc && chapterSpan(toc, chapter)?.labels) ?? [chapter];
      await send({ op: "write", chapter, labels, provider }, "The quiz couldn't be started.");
    },
    [send, provider, toc],
  );

  /** Saves a finished test or retest. */
  const submit = useCallback((sitting: SittingRecord) => send({ op: "attempt", ...sitting }, "The attempt couldn't be saved."), [send]);

  /** Remembers that the reader passed over a chapter's quiz, or the retest of one test, so its notice stays away. */
  const skip = useCallback((chapter: string, retestOf?: string) => void send({ op: "skip", chapter, retestOf }, "That couldn't be saved."), [send]);

  /** Grades a written answer to one question. Resolves to the graded turn, to why it couldn't be graded, or to null when `signal` stopped it. */
  const grade = useCallback(
    async (chapter: string, questionId: string, answer: string, signal: AbortSignal): Promise<{ turn: LearnerTurn } | { error: string } | null> => {
      try {
        const response = await request(bookId, { op: "grade", chapter, questionId, answer, provider }, signal);
        const body = (await response.json().catch(() => null)) as { turn?: LearnerTurn; error?: string } | null;
        return response.ok && body?.turn ? { turn: body.turn } : { error: body?.error ?? `Grading failed with ${response.status}.` };
      } catch {
        return signal.aborted ? null : { error: "Could not reach the app." };
      }
    },
    [bookId, provider],
  );

  /* While a quiz is being written, look for it now and then; it never blocks anything. */
  useEffect(() => {
    if (!jobs.writing.length) return;
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/books/${bookId}/quizzes`, { cache: "no-store" }).catch(() => null);
      if (response?.ok) setJobs((await response.json()) as Jobs);
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [jobs, bookId]);

  const entry = useChapter(spot);
  const index = toc && entry ? toc.indexOf(entry) : -1;
  const previous = useRef<number>(-1);
  /* The chapter of the book's own the reader is in, and since when. */
  const stay = useRef<{ chapter: string | null; since: number }>({ chapter: null, since: 0 });
  const startWriting = useRef(write);
  useEffect(() => {
    startWriting.current = write;
  });
  useEffect(() => {
    const before = previous.current;
    previous.current = index;
    if (!toc || index < 0) return;
    const left = stay.current;
    const here = chapterOf(toc, index, ownChapters);
    if (here !== left.chapter) stay.current = { chapter: here, since: Date.now() };
    if (before < 0 || index <= before) return;
    const offer = (chapter: string) => {
      setFinished(chapter);
      if (!jobs.quizzes.some((quiz) => quiz.chapter === chapter) && !jobs.writing.includes(chapter)) void startWriting.current(chapter);
    };
    /* Leaving a Course chapter for a later place finishes it. */
    for (const chapter of chapters) {
      const span = chapterSpan(toc, chapter);
      if (span && before >= span.start && before < span.end && leftChapter(span, index)) offer(chapter);
    }
    /* One of the book's own is finished by reading on into what follows it, after some time in it, and is offered
       once: not after its quiz was passed over or taken. */
    const span = left.chapter && here !== left.chapter ? chapterSpan(toc, left.chapter) : null;
    if (!span || !left.chapter || index < span.end || index > span.end + 1 || Date.now() - left.since < MIN_READ_MS) return;
    if (jobs.skips.some((s) => s.chapter === left.chapter && !s.retestOf)) return;
    if (jobs.quizzes.find((quiz) => quiz.chapter === left.chapter)?.attempts.some((attempt) => attempt.kind !== "review")) return;
    offer(left.chapter);
    // Only a move to another entry counts; the quizzes and jobs are read as they are then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, toc, chapters, ownChapters]);

  /** The Course chapter being read, and the first Course that says it comes later than it should. */
  const current = toc && index >= 0 ? chapterOf(toc, index, chapters) : null;
  let gate: { course: string; step: StepState } | null = null;
  if (current) {
    for (const course of steps) {
      const step = course.states.find((s) => s.bookId === bookId && s.chapter === current);
      if (step?.locked) {
        gate = { course: course.name, step };
        break;
      }
    }
  }

  const quizFor = useCallback((chapter: string) => jobs.quizzes.find((quiz) => quiz.chapter === chapter), [jobs.quizzes]);
  /** Whether a Course reads the chapter, so that passing its quiz opens the next one. */
  const gated = useCallback((chapter: string) => chapters.includes(chapter), [chapters]);
  const retest = useMemo(() => nextRetest(jobs.quizzes, jobs.skips, openedAt), [jobs.quizzes, jobs.skips, openedAt]);

  return {
    chapters,
    quizzes: jobs.quizzes,
    writing: jobs.writing,
    failed: jobs.failed,
    error,
    finished,
    dismissFinished: () => setFinished(null),
    /** A retest that is due, to offer when nothing was just finished. */
    retest,
    current,
    gate,
    gated,
    steps,
    quizFor,
    write,
    submit,
    skip,
    grade,
  };
}

export type QuizzesApi = ReturnType<typeof useQuizzes>;
