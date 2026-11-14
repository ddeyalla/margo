"use client";

import { useEffect, useRef, type ReactNode } from "react";
import clsx from "clsx";
import { LoaderCircle, Mic } from "lucide-react";
import type { Dictation } from "./useDictation";

const MB = 1_000_000;

const LABELS = {
  idle: "Speak instead of typing",
  starting: "Cancel dictation",
  recording: "Stop and transcribe",
  transcribing: "Transcribing",
  consent: "Cancel voice setup",
  downloading: "Cancel voice setup",
} as const;

/* Each bar's share of the level, so they move like a voice rather than in step. */
const BARS = [0.55, 1, 0.75, 0.4];

/** Bars that follow how loud the mic is, drawn every frame without re-rendering. */
function LevelBars({ level }: { level(): number }) {
  const bars = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    let smooth = 0;
    const draw = () => {
      smooth += (level() - smooth) * 0.35;
      bars.current?.childNodes.forEach((bar, i) => {
        (bar as HTMLElement).style.transform = `scaleY(${Math.max(0.18, Math.min(1, smooth * BARS[i] * 1.6))})`;
      });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [level]);
  return (
    <span ref={bars} aria-hidden className="flex h-3.5 items-center gap-[2px]">
      {BARS.map((_, i) => (
        <span key={i} className="block h-full w-[2.5px] origin-center scale-y-[0.18] rounded-full bg-current" />
      ))}
    </span>
  );
}

/** The mic. Click to start, click again to stop. Pressing it never takes focus from the field or clears a text selection. */
export function MicButton({ dictation, disabled = false, className }: { dictation: Dictation; disabled?: boolean; className?: string }) {
  const { phase } = dictation;
  const recording = phase === "recording";
  return (
    <button
      type="button"
      aria-label={LABELS[phase]}
      aria-pressed={recording}
      aria-busy={phase === "transcribing"}
      title={phase === "idle" ? LABELS.idle : undefined}
      disabled={disabled || phase === "transcribing"}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => void dictation.toggle()}
      className={clsx(
        "press grid h-7 min-w-7 shrink-0 place-items-center rounded-full px-1 transition-colors duration-[var(--duration-fast)] focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40",
        recording ? "bg-danger/20 text-danger" : "text-dim hover:bg-white/[0.06] hover:text-paper",
        className,
      )}
    >
      {phase === "transcribing" ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
      ) : recording ? (
        <LevelBars level={dictation.level} />
      ) : (
        <Mic className="size-4" aria-hidden />
      )}
    </button>
  );
}

/** What dictation is doing, said in words, and the ask before the first download. Renders nothing while idle and quiet. */
export function DictationNote({ dictation, className }: { dictation: Dictation; className?: string }) {
  const { phase, note, progress } = dictation;
  const button =
    "press rounded-sm px-1.5 py-0.5 text-[11px] text-paper outline-none hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-accent";
  let body: ReactNode = null;
  /* Recording and transcribing show on the button itself, so the field keeps its size. */
  if (phase === "consent") {
    body = (
      <>
        {note?.error ? `${note.text} ` : null}
        Voice input needs a speech model, about 490 MB, downloaded once. It runs on this Mac and no audio leaves it.{" "}
        <button type="button" className={button} onMouseDown={(event) => event.preventDefault()} onClick={() => void dictation.confirmDownload()}>
          Download
        </button>
        <button type="button" className={button} onMouseDown={(event) => event.preventDefault()} onClick={dictation.cancel}>
          Not now
        </button>
      </>
    );
  } else if (phase === "downloading") {
    const percent = progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
    body = (
      <>
        Downloading the speech model, {Math.round(progress.done / MB)} of {progress.total ? Math.round(progress.total / MB) : 487} MB
        <span aria-hidden className="mt-1 block h-1 overflow-hidden rounded-full bg-white/[0.08]">
          <span className="block h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
        </span>
      </>
    );
  } else if (note) body = note.text;
  if (!body) return null;
  return (
    <p role="status" className={clsx("text-[11px] leading-relaxed", phase === "idle" && note?.error ? "text-danger" : "text-dim", className)}>
      {body}
    </p>
  );
}
