import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Check, Lock, MessagesSquare } from "lucide-react";
import { DeleteCourse } from "@/components/courses/DeleteCourse";
import { PageShell } from "@/components/courses/PageShell";
import { CourseBookLine, RoadmapFacts } from "@/components/courses/RoadmapCard";
import { Spinner } from "@/components/ui";
import { WeekView } from "@/components/courses/WeekView";
import { readActivity } from "@/lib/server/activity";
import { masteryOf, readingProgress, stepQuizzes, type StepQuiz } from "@/lib/server/courses/progress";
import { readCourses } from "@/lib/server/courses/store";
import { courseSteps } from "@/lib/shared/courses";
import { dayTimes, emptyActivity, lastDays, masteryLine } from "@/lib/shared/mastery";
import { stepKey, stepStates, type StepState } from "@/lib/shared/quiz";

export default function CoursePage({ params }: PageProps<"/course/[id]">) {
  return (
    <PageShell>
      <Suspense fallback={<Spinner />}>
        <CourseView params={params} />
      </Suspense>
    </PageShell>
  );
}

async function CourseView({ params }: Pick<PageProps<"/course/[id]">, "params">) {
  await connection();
  const { id } = await params;
  const { courses } = await readCourses();
  const course = courses.find((c) => c.id === id);
  if (!course) notFound();
  const now = new Date();
  const [progress, quizzes, mastery, activity] = await Promise.all([readingProgress(course), stepQuizzes(course), masteryOf(course, now), readActivity().catch(emptyActivity)]);
  const week = dayTimes(activity, lastDays(now), new Set(courseSteps(course).map((step) => step.bookId)));
  const states = new Map(
    stepStates(courseSteps(course), new Set([...quizzes].filter(([, quiz]) => quiz.passed).map(([key]) => key))).map((state) => [stepKey(state.bookId, state.chapter), state]),
  );
  const passedCount = [...states.values()].filter((state) => state.passed).length;
  const books = new Map(course.books.map((book) => [book.key, book]));
  const present = course.books.filter((book) => book.bookId);
  const started = present.filter((book) => progress.get(book.bookId!) !== null).length;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-display text-paper">{course.name}</h1>
        <p className="text-callout leading-relaxed text-fog">{course.goal}</p>
        <RoadmapFacts roadmap={course} />
        <p className="text-callout font-medium tabular-nums text-paper" title="Covered: chapters whose quiz you passed. Retained: predicted recall of this Course's cards and quiz questions today.">
          {masteryLine(mastery)}
        </p>
        <p className="text-label tabular-nums text-dim">
          {started} of {present.length} {present.length === 1 ? "book" : "books"} started
          {course.books.length > present.length ? ` · ${course.books.length - present.length} to find` : null}
          {states.size ? ` · ${passedCount} of ${states.size} ${states.size === 1 ? "chapter" : "chapters"} passed` : null}
        </p>
        <div className="mt-1 flex items-center gap-2">
          {course.planId ? (
            <Link
              href={`/plan?id=${course.planId}`}
              className="press inline-flex h-7 items-center gap-1.5 rounded-sm bg-panel-raised px-2.5 text-label font-medium text-paper shadow-chip hover:bg-panel-hover"
            >
              <MessagesSquare aria-hidden className="size-3.5" />
              Change the plan
            </Link>
          ) : null}
          <DeleteCourse id={course.id} />
        </div>
      </div>

      <section className="rounded-xl bg-panel px-4 py-3 shadow-canvas">
        <WeekView days={week} title="This week in this Course" />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-body font-semibold uppercase tracking-wide text-dim">Units</h2>
        <ol className="flex flex-col gap-4">
          {course.units.map((unit, index) => (
            <li key={index} className="flex flex-col gap-2 rounded-xl bg-panel px-4 py-3 shadow-canvas">
              <p className="text-callout font-medium text-paper">
                {index + 1}. {unit.title}
                {unit.weeks ? <span className="font-normal text-dim"> · {unit.weeks} wk</span> : null}
              </p>
              {unit.concepts.length ? <p className="text-label leading-snug text-dim">{unit.concepts.join(" · ")}</p> : null}
              {unit.readings.map((reading, r) => {
                const book = books.get(reading.book);
                return (
                  <div key={r} className="flex flex-col gap-0.5">
                    <p className="text-body text-fog">{book?.title ?? reading.book}</p>
                    <ul className="flex flex-col gap-0.5 pl-3">
                      {reading.chapters.map((chapter, c) => (
                        <li key={c} className={`flex items-baseline gap-2 text-label leading-snug ${chapter.inBook || !book?.bookId ? "text-prose/80" : "text-dim"}`}>
                          <span className="min-w-0">
                            {chapter.title}
                            {!chapter.inBook && book?.bookId ? " (not found in your copy)" : null}
                          </span>
                          {book?.bookId && chapter.inBook ? (
                            <ChapterStatus
                              bookId={book.bookId}
                              chapter={chapter.title}
                              state={states.get(stepKey(book.bookId, chapter.title))}
                              quiz={quizzes.get(stepKey(book.bookId, chapter.title))}
                            />
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-body font-semibold uppercase tracking-wide text-dim">Books</h2>
        <div className="flex flex-col rounded-xl bg-panel px-4 py-2 shadow-canvas">
          {course.books.map((book) => (
            <CourseBookLine key={book.key} book={book} progress={book.bookId ? (progress.get(book.bookId) ?? null) : undefined} />
          ))}
        </div>
      </section>
    </div>
  );
}

/** Where a Course chapter stands: passed, its quiz ready or being written, or waiting on the chapter before it. */
function ChapterStatus({ bookId, chapter, state, quiz }: { bookId: string; chapter: string; state?: StepState; quiz?: StepQuiz }) {
  if (!state) return null;
  const href = `/book/${bookId}?quiz=${encodeURIComponent(chapter)}`;
  if (state.passed)
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-live">
        <Check aria-hidden className="size-3" />
        Passed
      </span>
    );
  if (quiz?.written)
    return (
      <Link href={href} className="press shrink-0 font-medium text-paper underline-offset-2 hover:underline">
        Take quiz
      </Link>
    );
  if (quiz?.writing) return <span className="shrink-0 text-dim">Quiz being written</span>;
  if (state.locked)
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-dim" title={state.previous ? `Comes after “${state.previous.chapter}”` : undefined}>
        <Lock aria-hidden className="size-3" />
        After the one before
      </span>
    );
  return <span className="shrink-0 text-dim">Quiz after reading</span>;
}
