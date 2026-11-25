import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight, GraduationCap } from "lucide-react";
import { readCourses } from "@/lib/server/courses/store";

/**
 * The top of home: a box to say what you want to learn, which opens the planning chat with it, and the Courses
 * made so far. A courses file that can't be read hides the list rather than failing the library under it.
 */
export async function HomeCourses() {
  await connection();
  const { courses } = await readCourses().catch(() => ({ courses: [] }));
  return (
    <section className="mb-10 flex flex-col gap-3">
      <form action="/plan" className="flex items-center gap-2 rounded-xl bg-panel px-3 py-2 shadow-canvas">
        <GraduationCap aria-hidden className="size-4 shrink-0 text-dim" />
        <input
          name="q"
          required
          aria-label="What do you want to learn?"
          placeholder="What do you want to learn? The tutor plans a course from your books."
          className="h-8 min-w-0 flex-1 bg-transparent text-[14px] text-paper outline-none placeholder:text-dim"
        />
        <button type="submit" className="press inline-flex h-7 items-center gap-1 rounded-sm bg-accent px-2.5 text-label font-medium text-on-accent">
          Plan
          <ArrowRight aria-hidden className="size-3.5" />
        </button>
      </form>
      {courses.length ? (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <li key={course.id}>
              <Link href={`/course/${course.id}`} className="press flex flex-col gap-1 rounded-xl bg-panel px-3 py-2.5 shadow-canvas hover:bg-panel-hover">
                <span className="truncate text-[14px] font-medium text-paper">{course.name}</span>
                <span className="text-label tabular-nums text-dim">
                  {course.units.length} {course.units.length === 1 ? "unit" : "units"} · {course.books.length} {course.books.length === 1 ? "book" : "books"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
