"use client";

import type { ReactNode } from "react";
import clsx from "clsx";
import { LoaderCircle, Mic, Square } from "lucide-react";
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
      title={recording ? "Stop (Esc cancels)" : phase === "idle" ? "Speak instead of typing" : LABELS[phase]}
      disabled={disabled || phase === "transcribing"}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => void dictation.toggle()}
      className={clsx(
        "press grid size-7 shrink-0 place-items-center rounded-full transition-colors duration-[var(--duration-fast)] focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40",
        recording ? "bg-danger/20 text-danger" : "text-dim hover:bg-white/[0.06] hover:text-paper",
        className,
      )}
    >
      {phase === "transcribing" ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
      ) : recording ? (
        <Square size={10} fill="currentColor" className="animate-pulse" aria-hidden />
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
  if (phase === "starting") body = "Allow the microphone if asked…";
  else if (phase === "recording") body = "Listening. Click the mic to finish, Esc to cancel.";
  else if (phase === "transcribing") body = "Transcribing…";
  else if (phase === "consent") {
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
