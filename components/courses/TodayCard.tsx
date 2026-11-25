import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight, Flame, Snowflake } from "lucide-react";
import { readToday, type TodayStart } from "@/lib/server/today";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const startLink = (start: TodayStart) =>
  start.kind === "review"
    ? { href: `/book/${start.book.id}?review=1`, label: `Review ${plural(start.due, "card")}`, where: start.book.title }
    : start.kind === "quiz"
      ? { href: `/book/${start.book.id}?quiz=${encodeURIComponent(start.chapter)}`, label: "Take the quiz", where: start.chapter }
      : { href: `/book/${start.book.id}`, label: "Keep reading", where: start.book.title };

/**
 * The top of home: what is worth doing today, in one card. Cards due, the next chapter quiz, minutes left in the
 * book being read, the streak and today's minimum, and one button that starts the most useful of them. A library
 * that can't be read hides the card rather than failing home.
 */
export async function TodayCard() {
  await connection();
  const today = await readToday().catch((error: unknown) => {
    console.warn("Could not read today:", error);
    return null;
  });
  if (!today) return null;
  const { streak, start } = today;
  const link = start ? startLink(start) : null;
  const facts = [
    today.due ? `${plural(today.due, "card")} due` : "No cards due",
    today.quiz ? `quiz ready: ${today.quiz.chapter}` : null,
    today.current?.minutesLeft ? `about ${today.current.minutesLeft} min left in ${today.current.title}` : null,
  ].filter(Boolean);
  const minimum = streak.todayMet ? "Today’s minimum is met." : `${Math.min(today.minutesToday, today.minimumMinutes)} of ${today.minimumMinutes} min today, or one review session.`;

  return (
    <section aria-label="Today" className="mb-4 flex flex-col gap-3 rounded-xl bg-panel px-4 py-3 shadow-canvas sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[15px] font-semibold text-paper">Today</h2>
          <span className={`inline-flex items-center gap-1 text-label tabular-nums ${streak.current ? "text-fog" : "text-dim"}`}>
            <Flame aria-hidden className={`size-3.5 ${streak.todayMet ? "text-accent" : ""}`} />
            {streak.current ? `${plural(streak.current, "day")} streak` : "No streak yet"}
            {streak.longest > streak.current ? ` · best ${streak.longest}` : null}
          </span>
          {streak.freezes ? (
            <span className="inline-flex items-center gap-1 text-label tabular-nums text-dim" title="A freeze covers a missed day once this week's rest day is used. Earn one every seven days in a row.">
              <Snowflake aria-hidden className="size-3.5" />
              {plural(streak.freezes, "freeze")}
            </span>
          ) : null}
          <span className="text-label text-dim" title="One missed day a week doesn't break the streak.">
            {streak.restLeft ? "rest day available" : "rest day used"}
          </span>
        </div>
        <p className="text-label leading-relaxed text-fog [overflow-wrap:anywhere]">{facts.join(" · ")}</p>
        <p className="text-label text-dim">{minimum}</p>
      </div>
      {link ? (
        <Link
          href={link.href}
          className="press inline-flex h-9 max-w-full shrink-0 items-center gap-2 self-start rounded-full bg-accent px-4 text-[13px] font-semibold text-on-accent hover:bg-accent/90 sm:self-center"
          title={link.where}
        >
          <span className="truncate">{link.label}</span>
          <ArrowRight aria-hidden className="size-4 shrink-0" />
        </Link>
      ) : null}
    </section>
  );
}
