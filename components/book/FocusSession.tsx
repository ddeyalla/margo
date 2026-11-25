"use client";

import { useEffect, useRef, useState } from "react";
import { Hand, Timer } from "lucide-react";
import { Button, IconButton, Segmented } from "@/components/ui";
import { fetchFocusPreview } from "@/lib/client/api";
import { blockingLine, DEFAULT_FOCUS_MINUTES, FOCUS_CHOICES, type FocusBlocking } from "@/lib/shared/focus";
import { formatRemaining } from "./useFocusSession";

const minutesText = (minutes: number) => `${minutes} minute${minutes === 1 ? "" : "s"}`;

const CHOICES = FOCUS_CHOICES.map((minutes) => ({ value: String(minutes), label: `${minutes}` }));

/**
 * The header's way into a focus session: pick a length and start. It says up front what Three will block, so
 * nobody finds out mid-session that their distractions were never covered.
 */
export function FocusButton({ disabled, onStart }: { disabled: boolean; onStart(minutes: number): void }) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(String(DEFAULT_FOCUS_MINUTES));
  const [preview, setPreview] = useState<FocusBlocking | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void fetchFocusPreview().then((blocking) => live && setPreview(blocking));
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      live = false;
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <IconButton label="Focus session: read on a timer, distractions blocked" active={open} disabled={disabled} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Timer />
      </IconButton>
      {open ? (
        <div
          role="dialog"
          aria-label="Focus session"
          className="absolute right-0 top-full z-40 mt-2 flex w-72 origin-top-right flex-col gap-3 rounded-xl bg-panel-raised p-4 shadow-dialog transition-[opacity,scale] duration-[var(--duration-enter)] ease-out starting:scale-[0.97] starting:opacity-0 motion-reduce:transition-none"
        >
          <div className="flex flex-col gap-1">
            <span className="text-section text-paper">Focus session</span>
            <span className="text-label text-dim">The page clears, the tutor waits, and you read until the time is up.</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-label text-fog">Minutes</span>
            <Segmented label="Session length in minutes" options={CHOICES} value={minutes} onChange={setMinutes} />
          </div>
          <p className="text-caption text-dim">{preview ? blockingLine(preview) : "Checking what Three can block…"}</p>
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              setOpen(false);
              onStart(Number(minutes));
            }}
          >
            Start {minutes} minutes
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The time left, small and steady at the top of the page, with the way out. No animation: it changes every second. */
export function FocusClock({ remaining, blocking, starting, onEnd }: { remaining: number; blocking: FocusBlocking | null; starting: boolean; onEnd(): void }) {
  const blocked = blocking?.state === "on";
  return (
    <div
      role="timer"
      aria-label={starting ? "Starting the focus session" : `${formatRemaining(remaining)} left in this focus session`}
      title={blocking ? blockingLine(blocking) : undefined}
      className="animate-rise absolute left-1/2 top-3 z-30 flex h-7 -translate-x-1/2 items-center gap-2 rounded-full pl-3 pr-1 text-label text-page-dim"
    >
      {blocked ? <Hand aria-hidden className="size-3.5" /> : <Timer aria-hidden className="size-3.5" />}
      <span className="min-w-[4ch] font-medium tabular-nums text-prose/80">{starting ? "–:––" : formatRemaining(remaining)}</span>
      <button
        type="button"
        onClick={onEnd}
        disabled={starting}
        className="press h-6 rounded-full px-2 text-label text-page-dim transition-colors duration-[var(--duration-fast)] hover:bg-prose/[0.06] hover:text-prose disabled:opacity-40"
      >
        End
      </button>
    </div>
  );
}

/**
 * The end of a session asks for recall before anything else: writing the ideas from memory is what makes them
 * stick, and the tutor then checks them against the book. Skipping is always one click.
 */
export function FocusRecap({
  minutes,
  early,
  askBlocked,
  onAsk,
  onSkip,
}: {
  minutes: number;
  early: boolean;
  /** Why the tutor can't take the recall right now, or null when it can. */
  askBlocked: string | null;
  onAsk(text: string): void;
  onSkip(): void;
}) {
  const [text, setText] = useState("");
  const ask = () => {
    if (text.trim() && !askBlocked) onAsk(text.trim());
  };
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-page/70 p-6 backdrop-blur-[2px]">
      <form
        role="dialog"
        aria-labelledby="focus-recap-title"
        onSubmit={(event) => {
          event.preventDefault();
          ask();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onSkip();
        }}
        className="animate-rise flex w-[min(440px,100%)] flex-col gap-4 rounded-xl bg-panel-raised p-5 shadow-dialog"
      >
        <div className="flex flex-col gap-1">
          <h2 id="focus-recap-title" className="text-headline font-semibold text-paper">
            {early ? (minutes ? `${minutesText(minutes)} read` : "Session ended") : `${minutesText(minutes)}, done`}
          </h2>
          <p className="text-body text-fog">What are the two ideas worth keeping? Write them from memory; the tutor will check them against the book.</p>
        </div>
        <textarea
          autoFocus
          rows={4}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              ask();
            }
          }}
          placeholder={"1. \n2. "}
          className="resize-none rounded-md bg-panel px-3 py-2 text-callout text-paper shadow-chip outline-none placeholder:text-dim focus-visible:ring-1 focus-visible:ring-line-strong"
        />
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="md" onClick={onSkip}>
            Skip
          </Button>
          <span title={askBlocked ?? undefined} className="inline-flex">
            <Button type="submit" variant="primary" size="md" disabled={!text.trim() || !!askBlocked}>
              Check with the tutor
            </Button>
          </span>
        </div>
      </form>
    </div>
  );
}
