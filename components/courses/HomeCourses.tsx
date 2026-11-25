import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight, ChevronRight, Plus } from "lucide-react";
import clsx from "clsx";
import { masteryOf, passedSteps } from "@/lib/server/courses/progress";
import { readCourses } from "@/lib/server/courses/store";
import { courseSteps, type Course } from "@/lib/shared/courses";
import { masteryLine } from "@/lib/shared/mastery";
import { stepKey } from "@/lib/shared/quiz";

type UnitState = "done" | "started" | "todo";

/** Each unit as done, started or not yet, and the first chapter still to pass. */
async function progressOf(course: Course) {
  const steps = courseSteps(course);
  const passed = await passedSteps(course);
  const isPassed = (step: (typeof steps)[number]) => passed.has(stepKey(step.bookId, step.chapter));
  const units: UnitState[] = course.units.map((_, index) => {
    const own = steps.filter((step) => step.unit === index);
    const done = own.filter(isPassed).length;
    return own.length && done === own.length ? "done" : done ? "started" : "todo";
  });
  const next = steps.find((step) => !isPassed(step)) ?? null;
  return { units, next };
}

const PIP: Record<UnitState, string> = { done: "bg-live", started: "bg-paper/70", todo: "bg-tint-strong" };

/**
 * The Courses on home, one quiet row each: the name, the chapter to pass next, and a pip per unit. The heading
 * holds the way to plan another. A courses file that can't be read hides the rows rather than failing home.
 */
export async function HomeCourses() {
  await connection();
  const now = new Date();
  const { courses } = await readCourses().catch(() => ({ courses: [] as Course[] }));
  const rows = await Promise.all(courses.map(async (course) => ({ course, mastery: await masteryOf(course, now), ...(await progressOf(course)) })));

  return (
    <section aria-labelledby="courses" className="mb-12 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="courses" className="text-section text-fog">
          Courses
        </h2>
        <Link href="/plan" className="inline-flex items-center gap-1 rounded-xs text-label text-dim hover:text-paper">
          <Plus aria-hidden className="size-3.5" />
          New course
        </Link>
      </div>
      {rows.length ? (
        <ul className="flex flex-col gap-1.5">
          {rows.map(({ course, mastery, units, next }) => {
            const current = units.findIndex((unit) => unit !== "done");
            return (
              <li key={course.id}>
                <Link
                  href={`/course/${course.id}`}
                  className="press group flex items-center gap-4 rounded-xl bg-panel px-4 py-3 shadow-canvas hover:bg-panel-hover"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-callout font-medium text-paper">{course.name}</span>
                    <span className="truncate text-label tabular-nums text-dim">
                      {next ? `Next: ${next.chapter}` : "Every chapter passed"} · {masteryLine(mastery)}
                    </span>
                  </div>
                  <span aria-hidden className="hidden items-center gap-1 sm:flex">
                    {units.map((unit, index) => (
                      <span key={index} className={clsx("h-1 w-3.5 rounded-full", PIP[unit])} />
                    ))}
                  </span>
                  <span className="shrink-0 text-label tabular-nums text-dim">
                    {current === -1 ? "Done" : `Unit ${current + 1} of ${units.length}`}
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-dim transition-transform duration-[var(--duration-fast)] ease-out group-hover:translate-x-0.5" />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <Link
          href="/plan"
          className="press group flex items-center justify-between gap-4 rounded-xl border border-dashed border-line-strong px-4 py-3 text-body text-dim hover:border-fog hover:text-paper"
        >
          Say what you want to learn, and the tutor plans a course from your books.
          <ArrowRight aria-hidden className="size-4 shrink-0 transition-transform duration-[var(--duration-fast)] ease-out group-hover:translate-x-0.5" />
        </Link>
      )}
    </section>
  );
}
