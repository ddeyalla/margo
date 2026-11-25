import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { MessagesSquare } from "lucide-react";
import { DeleteCourse } from "@/components/courses/DeleteCourse";
import { PageShell } from "@/components/courses/PageShell";
import { CourseBookLine, RoadmapFacts } from "@/components/courses/RoadmapCard";
import { Spinner } from "@/components/ui";
import { readingProgress } from "@/lib/server/courses/progress";
import { readCourses } from "@/lib/server/courses/store";

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
  const progress = await readingProgress(course);
  const books = new Map(course.books.map((book) => [book.key, book]));
  const present = course.books.filter((book) => book.bookId);
  const started = present.filter((book) => progress.get(book.bookId!) !== null).length;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-display text-paper">{course.name}</h1>
        <p className="text-[14px] leading-relaxed text-fog">{course.goal}</p>
        <RoadmapFacts roadmap={course} />
        <p className="text-label tabular-nums text-dim">
          {started} of {present.length} {present.length === 1 ? "book" : "books"} started
          {course.books.length > present.length ? ` · ${course.books.length - present.length} to find` : null}
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

      <section className="flex flex-col gap-4">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-dim">Units</h2>
        <ol className="flex flex-col gap-4">
          {course.units.map((unit, index) => (
            <li key={index} className="flex flex-col gap-2 rounded-xl bg-panel px-4 py-3 shadow-canvas">
              <p className="text-[14px] font-medium text-paper">
                {index + 1}. {unit.title}
                {unit.weeks ? <span className="font-normal text-dim"> · {unit.weeks} wk</span> : null}
              </p>
              {unit.concepts.length ? <p className="text-label leading-snug text-dim">{unit.concepts.join(" · ")}</p> : null}
              {unit.readings.map((reading, r) => {
                const book = books.get(reading.book);
                return (
                  <div key={r} className="flex flex-col gap-0.5">
                    <p className="text-[13px] text-fog">{book?.title ?? reading.book}</p>
                    <ul className="flex flex-col gap-0.5 pl-3">
                      {reading.chapters.map((chapter, c) => (
                        <li key={c} className={`text-label leading-snug ${chapter.inBook || !book?.bookId ? "text-prose/80" : "text-dim"}`}>
                          {chapter.title}
                          {!chapter.inBook && book?.bookId ? " (not found in your copy)" : null}
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
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-dim">Books</h2>
        <div className="flex flex-col rounded-xl bg-panel px-4 py-2 shadow-canvas">
          {course.books.map((book) => (
            <CourseBookLine key={book.key} book={book} progress={book.bookId ? (progress.get(book.bookId) ?? null) : undefined} />
          ))}
        </div>
      </section>
    </div>
  );
}
