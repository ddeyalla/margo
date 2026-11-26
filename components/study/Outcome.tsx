"use client";

import { Button } from "@/components/ui";
import { locateSpan, standing, type LearnerTurn, type Overrule } from "@/lib/shared/study";

/* How a graded answer is shown, in the Go deeper sheet and in a chapter test. */

/** The passage, with the stretch the grader pointed at marked when it can be found in it as written. */
export function Passage({ quote, span, onJump }: { quote: string; span?: string; onJump(): void }) {
  const found = span ? locateSpan(quote, span) : null;
  return (
    <button type="button" onClick={onJump} title="Go to this passage" className="press block w-full rounded-lg bg-tint p-3 text-left">
      <span className="whitespace-pre-line font-reading text-callout leading-relaxed text-prose">
        {found ? (
          <>
            {quote.slice(0, found[0])}
            <mark className="rounded-xs bg-highlight text-inherit">{quote.slice(found[0], found[1])}</mark>
            {quote.slice(found[1])}
          </>
        ) : (
          quote
        )}
      </span>
      {span && !found ? <span className="mt-2 block border-l border-line-strong pl-3 font-reading text-label leading-relaxed text-dim">{span}</span> : null}
    </button>
  );
}

const HEADLINES = { right: "Right.", partly: "Partly right.", wrong: "Not right yet.", unsure: "Not sure about this one." };

const OVERRULES: { value: Overrule; label: string }[] = [
  { value: "right", label: "I had it" },
  { value: "wrong", label: "I missed it" },
];

/** How an answer was judged: the verdict, or that the grader couldn't settle it, the first gap, and the reader's say over both. */
export function Outcome({ turn, quote, onOverrule, onJump }: { turn: LearnerTurn; quote: string; onOverrule(override: Overrule | null): void; onJump(): void }) {
  const stands = standing(turn);
  return (
    <div className="animate-rise flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-headline font-medium text-paper">{turn.override ? (turn.override === "right" ? "You marked it right." : "You marked it as missed.") : HEADLINES[stands]}</p>
        {stands === "unsure" ? <p className="text-label text-dim">The grader couldn’t settle this one, so it’s your call.</p> : null}
      </div>
      <p className="text-label text-dim">You wrote: “{turn.answer}”</p>
      {turn.gap ? (
        <div className="flex flex-col gap-1">
          <p className="text-caption text-dim">What it was looking for</p>
          <p className="text-callout leading-relaxed text-prose">{turn.gap.point}</p>
          <p className="text-callout leading-relaxed text-prose">{turn.gap.note}</p>
        </div>
      ) : null}
      <Passage quote={quote} span={turn.gap?.span} onJump={onJump} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-label text-dim">{turn.override ? (turn.unsure ? "The grader wasn’t sure." : "The grader said otherwise.") : stands === "unsure" ? "Which was it?" : "Disagree?"}</span>
        {OVERRULES.filter(({ value }) => turn.override !== null || turn.unsure || turn.verdict !== value).map(({ value, label }) => (
          <Button key={value} aria-pressed={turn.override === value} variant={turn.override === value ? "primary" : "outline"} onClick={() => onOverrule(turn.override === value ? null : value)}>
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}
