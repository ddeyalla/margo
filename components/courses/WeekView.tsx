import { learned, minutes, type DayTime } from "@/lib/shared/mastery";

const weekday = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en", { weekday: "short" });
};

const describe = (time: DayTime) => {
  const parts = (["reading", "review", "quiz"] as const).filter((kind) => time.seconds[kind] >= 30).map((kind) => `${minutes(time.seconds[kind])} min ${kind}`);
  return parts.length ? parts.join(", ") : learned(time) ? "Under a minute" : "Nothing";
};

/**
 * The last seven study days: minutes learned on each, as bars, with the days learned marked. Over every book on
 * home, over a Course's books on its page.
 */
export function WeekView({ days, title }: { days: DayTime[]; title: string }) {
  const most = Math.max(...days.map((time) => time.total), 1);
  const learnedDays = days.filter(learned).length;
  const week = days.reduce((sum, time) => sum + time.total, 0);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-label tabular-nums text-dim">
        <span className="font-medium text-fog">{title}</span> · learned {learnedDays} of {days.length} days · {minutes(week)} min
      </p>
      <ol className="grid grid-cols-7 gap-1.5" aria-label={title}>
        {days.map((time, i) => (
          <li key={time.day} className="flex flex-col items-center gap-1" title={`${time.day}: ${describe(time)}`}>
            <span className="text-[11px] tabular-nums text-dim">{learned(time) ? minutes(time.total) : ""}</span>
            <span className="flex h-12 w-full items-end border-b border-line-strong">
              <span className={`w-full rounded-t-sm ${learned(time) ? "bg-accent/80" : ""}`} style={{ height: `${Math.max(learned(time) ? 8 : 0, (100 * time.total) / most)}%` }} />
            </span>
            <span className={`text-[11px] ${i === days.length - 1 ? "font-medium text-fog" : "text-dim"}`}>{i === days.length - 1 ? "Today" : weekday(time.day)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
