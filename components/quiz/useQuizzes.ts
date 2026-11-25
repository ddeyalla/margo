"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChapter, type PlaceStore } from "@/components/book/place";
import type { TocEntry } from "@/components/reader/types";
import type { CourseContext } from "@/lib/shared/courses";
import { chapterOf, chapterSpan, isPassed, leftChapter, stepKey, stepStates, type ChapterQuiz, type QuizAnswer, type StepState } from "@/lib/shared/quiz";
import type { BookId, ProviderId } from "@/lib/shared/types";

interface Jobs {
  quizzes: ChapterQuiz[];
  writing: string[];
  failed: { chapter: string; error: string }[];
}

/** How often to look for a quiz being written. */
const POLL_MS = 4000;

const post = async (bookId: BookId, body: unknown): Promise<Jobs> => {
  const response = await fetch(`/api/books/${bookId}/quizzes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const answer = (await response.json().catch(() => null)) as (Jobs & { error?: string }) | null;
  if (!response.ok || !answer?.quizzes) throw new Error(answer?.error ?? `The quiz request failed with ${response.status}.`);
  return answer;
};

/**
 * The book's chapter quizzes, for the chapters of it a Course reads. Leaving such a chapter for a later one
 * starts writing its quiz, once; the reader can also ask for it. Books in no Course get none of this.
 */
export function useQuizzes({
  bookId,
  initial,
  courses,
  spot,
  toc,
  provider,
}: {
  bookId: BookId;
  initial: ChapterQuiz[];
  courses: CourseContext[];
  spot: PlaceStore;
  toc: TocEntry[] | null;
  provider: ProviderId | null;
}) {
  const [jobs, setJobs] = useState<Jobs>({ quizzes: initial, writing: [], failed: [] });
  const [error, setError] = useState<string | null>(null);
  /* The chapter just finished, whose quiz the notice offers. */
  const [finished, setFinished] = useState<string | null>(null);

  /** This book's chapters in any Course, each once. */
  const chapters = useMemo(() => [...new Set(courses.flatMap((course) => course.steps.filter((step) => step.bookId === bookId).map((step) => step.chapter)))], [courses, bookId]);

  /** Each Course's steps with what this page knows: passes elsewhere from the server, and this book's from here. */
  const steps = useMemo(() => {
    const local = new Set(jobs.quizzes.filter(isPassed).map((quiz) => stepKey(bookId, quiz.chapter)));
    return courses.map((course) => {
      const passed = new Set(course.passed.filter((key) => !key.startsWith(`${bookId}\n`)));
      for (const key of local) passed.add(key);
      return { id: course.id, name: course.name, states: stepStates(course.steps, passed) };
    });
  }, [courses, jobs.quizzes, bookId]);

  const write = useCallback(
    async (chapter: string) => {
      if (!provider) return;
      setError(null);
      const labels = (toc && chapterSpan(toc, chapter)?.labels) ?? [chapter];
      try {
        setJobs(await post(bookId, { op: "write", chapter, labels, provider }));
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "The quiz couldn't be started.");
      }
    },
    [bookId, provider, toc],
  );

  const submit = useCallback(
    async (chapter: string, answers: QuizAnswer[]) => {
      try {
        setJobs(await post(bookId, { op: "attempt", chapter, answers }));
        return true;
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "The attempt couldn't be saved.");
        return false;
      }
    },
    [bookId],
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

  /* Leaving a Course chapter for a later place finishes it: write its quiz if it has none. */
  const entry = useChapter(spot);
  const index = toc && entry ? toc.indexOf(entry) : -1;
  const previous = useRef<number>(-1);
  const startWriting = useRef(write);
  useEffect(() => {
    startWriting.current = write;
  });
  useEffect(() => {
    const before = previous.current;
    previous.current = index;
    if (!toc || before < 0 || index <= before) return;
    for (const chapter of chapters) {
      const span = chapterSpan(toc, chapter);
      if (!span || before < span.start || before >= span.end || !leftChapter(span, index)) continue;
      setFinished(chapter);
      if (!jobs.quizzes.some((quiz) => quiz.chapter === chapter) && !jobs.writing.includes(chapter)) void startWriting.current(chapter);
    }
    // Only a move to another entry counts; the quizzes and jobs are read as they are then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, toc, chapters]);

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

  return {
    active: chapters.length > 0,
    chapters,
    quizzes: jobs.quizzes,
    writing: jobs.writing,
    failed: jobs.failed,
    error,
    finished,
    dismissFinished: () => setFinished(null),
    current,
    gate,
    steps,
    quizFor,
    write,
    submit,
  };
}

export type QuizzesApi = ReturnType<typeof useQuizzes>;
