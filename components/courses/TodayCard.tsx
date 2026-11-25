import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight } from "lucide-react";
import clsx from "clsx";
import { readActivity } from "@/lib/server/activity";
import { readToday, type Today } from "@/lib/server/today";
import { dayTimes, emptyActivity, lastDays, learned, type DayTime } from "@/lib/shared/mastery";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** The one thing worth doing now, as a sentence and the button that starts it. */
function nextStep({ start, current }: Today): { headline: React.ReactNode; action: { href: string; label: string } | null } {
  const title = (text: string) => <span className="font-reading font-normal italic">{text}</span>;
  if (start?.kind === "review") {
    return {
      headline: <>{plural(start.due, "card")} ready to review</>,
      action: { href: `/book/${start.book.id}?review=1`, label: "Review now" },
    };
  }
  if (start?.kind === "quiz") {
    return {
      headline: <>Ready for the quiz on {title(start.chapter)}</>,
      action: { href: `/book/${start.book.id}?quiz=${encodeURIComponent(start.chapter)}`, label: "Take the quiz" },
    };
  }
  if (start?.kind === "read") return { headline: <>Pick up {title(start.book.title)}</>, action: { href: `/book/${start.book.id}`, label: "Continue reading" } };
  if (current) return { headline: <>You finished {title(current.title)}</>, action: null };
  return { headline: <>Choose a book to start</>, action: null };
}

/** Seven dots, one a day, filled on the days something was learned. Today's is ringed. */
function WeekDots({ days }: { days: DayTime[] }) {
  const count = days.filter(learned).length;
  return (
    <span role="img" aria-label={`Learned on ${count} of the last ${days.length} days`} className="inline-flex items-center gap-1">
      {days.map((day, index) => (
        <span
          key={day.day}
          title={day.day}
          className={clsx(
            "size-[7px] rounded-full",
            learned(day) ? "bg-paper" : "bg-tint-strong",
            index === days.length - 1 && "ring-1 ring-fog ring-offset-1 ring-offset-ink",
          )}
        />
      ))}
    </span>
  );
}

/**
 * The top of home: what to do now, in one sentence with one button, and a single line of where the day and week
 * stand. Reviews come first, then a course quiz, then the book being read. A library that can't be read hides
 * it rather than failing home.
 */
export async function TodayCard() {
  await connection();
  const now = new Date();
  const [today, activity] = await Promise.all([
    readToday(now).catch((error: unknown) => {
      console.warn("Could not read today:", error);
      return null;
    }),
    readActivity().catch(emptyActivity),
  ]);
  if (!today) return null;
  const { headline, action } = nextStep(today);
  const { start, current, streak } = today;
  const keepReading = start && start.kind !== "read" && current && current.minutesLeft !== 0 ? current : null;

  const facts = [
    streak.current ? `${streak.current}-day streak` : null,
    streak.todayMet ? "today’s goal met" : `${Math.min(today.minutesToday, today.minimumMinutes)} of ${today.minimumMinutes} min today`,
    start?.kind !== "review" && today.due ? `${plural(today.due, "card")} due` : null,
    start?.kind === "read" && current?.minutesLeft ? `about ${current.minutesLeft} min left in this book` : null,
  ].filter(Boolean);

  return (
    <section aria-label="Today" className="mb-12 flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-display font-semibold text-paper [overflow-wrap:anywhere]">{headline}</h2>
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-body tabular-nums text-dim">
          <WeekDots days={dayTimes(activity, lastDays(now))} />
          {facts.map((fact) => (
            <span key={fact} className="before:mr-2.5 before:text-line-strong before:content-['·']">
              {fact}
            </span>
          ))}
        </p>
      </div>
      {action || keepReading ? (
        <div className="flex flex-wrap items-center gap-2">
          {action ? (
            <Link
              href={action.href}
              className="press inline-flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-body font-semibold text-on-accent hover:bg-accent/90"
            >
              {action.label}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          ) : null}
          {keepReading ? (
            <Link
              href={`/book/${keepReading.id}`}
              title={keepReading.title}
              className="press inline-flex h-9 max-w-full items-center rounded-full px-4 text-body font-medium text-fog shadow-chip hover:bg-tint hover:text-paper"
            >
              <span className="truncate">Keep reading</span>
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
