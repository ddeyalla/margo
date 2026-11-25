import Link from "next/link";
import { BookOpen, Search } from "lucide-react";
import type { CourseBook, Roadmap } from "@/lib/shared/courses";

const hours = (value: number) => `${value} ${value === 1 ? "hour" : "hours"} a week`;

/** The Course's level, weekly time and timeline, as one quiet line. */
export function RoadmapFacts({ roadmap }: { roadmap: Pick<Roadmap, "level" | "weeklyHours" | "timeline"> }) {
  const facts = [roadmap.level, roadmap.weeklyHours ? hours(roadmap.weeklyHours) : null, roadmap.timeline].filter(Boolean);
  return <p className="text-label text-dim">{facts.join(" · ")}</p>;
}

/** A book of the Course: a link into the reader when the library has it, or what to look for when it doesn't. */
export function CourseBookLine({ book, progress }: { book: CourseBook; progress?: number | null }) {
  if (book.bookId) {
    return (
      <Link href={`/book/${book.bookId}`} className="press flex items-start gap-2 rounded-sm py-1 hover:text-paper">
        <BookOpen aria-hidden className="mt-0.5 size-3.5 shrink-0 text-dim" />
        <span className="min-w-0 flex-1 text-[13px] text-paper">
          {book.title}
          {book.author ? <span className="text-dim">, {book.author}</span> : null}
        </span>
        {progress !== undefined ? (
          <span className="shrink-0 text-label tabular-nums text-dim">{progress === null ? "Not started" : `${Math.round(progress * 100)} % read`}</span>
        ) : null}
      </Link>
    );
  }
  return (
    <div className="flex items-start gap-2 py-1">
      <Search aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warn" />
      <span className="min-w-0 flex-1 text-[13px] text-fog">
        <span className="mr-1.5 rounded-xs bg-tint px-1 py-px text-[11px] font-medium text-warn">To find</span>
        {book.title}
        {book.author ? <span className="text-dim">, {book.author}</span> : null}
        {book.edition ? <span className="text-dim"> ({book.edition})</span> : null}
      </span>
    </div>
  );
}

/** A proposed roadmap: units with their concepts and readings, then the books. */
export function RoadmapCard({ roadmap, footer }: { roadmap: Roadmap; footer?: React.ReactNode }) {
  const books = new Map(roadmap.books.map((book) => [book.key, book]));
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-panel px-4 py-4 shadow-canvas">
      <div className="flex flex-col gap-1">
        <h3 className="text-[15px] font-semibold text-paper">{roadmap.name}</h3>
        <p className="text-[13px] leading-snug text-fog">{roadmap.goal}</p>
        <RoadmapFacts roadmap={roadmap} />
      </div>
      <ol className="flex flex-col gap-3">
        {roadmap.units.map((unit, index) => (
          <li key={index} className="flex flex-col gap-1">
            <p className="text-[13px] font-medium text-paper">
              {index + 1}. {unit.title}
              {unit.weeks ? <span className="font-normal text-dim"> · {unit.weeks} wk</span> : null}
            </p>
            {unit.concepts.length ? <p className="text-label leading-snug text-dim">{unit.concepts.join(" · ")}</p> : null}
            {unit.readings.map((reading, r) => {
              const book = books.get(reading.book);
              return (
                <p key={r} className="text-label leading-snug text-fog">
                  <span className="text-paper/90">{book?.title ?? reading.book}</span>
                  {reading.chapters.length ? ": " : null}
                  {reading.chapters.map((chapter, c) => (
                    <span key={c} className={chapter.inBook || !book?.bookId ? undefined : "text-dim"} title={chapter.inBook || !book?.bookId ? undefined : "Not found in your copy's table of contents"}>
                      {c ? "; " : null}
                      {chapter.title}
                      {!chapter.inBook && book?.bookId ? " (not in your copy)" : null}
                    </span>
                  ))}
                </p>
              );
            })}
          </li>
        ))}
      </ol>
      <div className="flex flex-col border-t border-line pt-2">
        {roadmap.books.map((book) => (
          <CourseBookLine key={book.key} book={book} />
        ))}
      </div>
      {footer}
    </div>
  );
}
