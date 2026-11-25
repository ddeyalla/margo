"use client";

import { useId } from "react";
import { MAX_THINKING, SIGNAL_LABELS, type Signal } from "@/lib/shared/confidence";

const fieldClass =
  "h-8 w-full rounded-sm bg-ink/60 px-2 text-[13px] text-paper outline-none ring-1 ring-line focus:ring-line-strong placeholder:text-dim";

/** Colours for a signal: confident and right is calm, confident and wrong is loud. */
export const SIGNAL_TONE: Record<Signal, string> = {
  held: "text-live",
  shaky: "text-fog",
  lucky: "text-warn",
  misconception: "text-danger",
  gap: "text-dim",
};

/**
 * How sure the reader is, and what they're thinking, asked before the answer shows. Both are optional: the rail
 * starts unset and reads "Skipped" until moved, and the line can stay empty. Enter in the line submits.
 */
export function StanceInput({
  confidence,
  thinking,
  onConfidence,
  onThinking,
  onSubmit,
  placeholder = "What are you thinking? (optional)",
}: {
  confidence: number | null;
  thinking: string;
  onConfidence(value: number | null): void;
  onThinking(value: string): void;
  onSubmit(): void;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-tint px-3 py-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-label">
          <label htmlFor={`${id}-sure`} className="font-medium text-fog">
            How sure are you?
          </label>
          <span className="flex-1" />
          <span className="tabular-nums text-dim">{confidence === null ? "Skipped" : `${confidence} %`}</span>
          {confidence !== null ? (
            <button type="button" onClick={() => onConfidence(null)} className="press text-dim underline-offset-2 hover:text-paper hover:underline">
              Skip
            </button>
          ) : null}
        </div>
        <input
          id={`${id}-sure`}
          type="range"
          min={0}
          max={100}
          step={5}
          value={confidence ?? 50}
          aria-valuetext={confidence === null ? "Skipped" : `${confidence} percent`}
          onChange={(event) => onConfidence(Number(event.target.value))}
          /* A click on the unset rail's middle sets nothing through onChange, so the first press sets it too. */
          onPointerDown={() => confidence === null && onConfidence(50)}
          className={`w-full accent-[var(--color-accent)] ${confidence === null ? "opacity-40" : ""}`}
        />
        <div className="flex justify-between text-[11px] text-dim" aria-hidden>
          <span>Guessing</span>
          <span>Certain</span>
        </div>
      </div>
      <input
        type="text"
        aria-label={placeholder}
        placeholder={placeholder}
        maxLength={MAX_THINKING}
        value={thinking}
        onChange={(event) => onThinking(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSubmit();
          }
        }}
        className={fieldClass}
      />
    </div>
  );
}

const ORDER: Signal[] = ["held", "shaky", "lucky", "gap", "misconception"];

/**
 * What a session's answers meant, at a glance: how many were held, lucky or confidently wrong, and which
 * questions were the lucky and the confidently wrong ones. Answers given without a confidence aren't counted.
 */
export function SignalSummary({ items }: { items: { question: string; signal: Signal | null }[] }) {
  const counts = ORDER.map((signal) => [signal, items.filter((item) => item.signal === signal).length] as const).filter(([, count]) => count);
  if (!counts.length) return null;
  const flagged = items.filter((item) => item.signal === "lucky" || item.signal === "misconception");
  return (
    <div className="flex w-full flex-col gap-2 text-left">
      <p className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-label tabular-nums">
        {counts.map(([signal, count]) => (
          <span key={signal} className={SIGNAL_TONE[signal]}>
            {count} {SIGNAL_LABELS[signal].toLowerCase()}
          </span>
        ))}
      </p>
      {flagged.length ? (
        <ul className="flex flex-col gap-1 rounded-lg bg-tint px-3 py-2">
          {flagged.map((item, i) => (
            <li key={i} className="flex gap-2 text-label leading-snug">
              <span className={`shrink-0 font-medium ${SIGNAL_TONE[item.signal!]}`}>{SIGNAL_LABELS[item.signal!]}</span>
              <span className="min-w-0 text-fog">{item.question}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
