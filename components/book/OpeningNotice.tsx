"use client";

import { Highlighter, NotebookPen, RotateCcw, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui";
import type { Mark } from "@/lib/shared/resume";

/** What greets the reader on a fresh open. Either part may be missing; the notice shows whichever it has. */
export interface OpeningNotice {
  resume: {
    /** The last sentence or two before the saved place, or null when the reader can't read it. */
    glimpse: string | null;
    /** The text before the glimpse, for the tutor, or null when there is none. */
    before: string | null;
    chapter: string | null;
    /** 0 to 1 through the book. */
    fraction: number;
    marks: Mark[];
  } | null;
  /** Card sets waiting for review. */
  due: number;
}

const cardsDue = (count: number) => `${count} ${count === 1 ? "card" : "cards"} due`;

/**
 * A small card over the bottom of the book, once, when the book opens: where the reader left off, their
 * latest marks in the chapter, and the cards that are due. It asks for nothing and leaves when the reader
 * scrolls, turns a page, presses Esc or closes it.
 */
export function OpeningNotice({
  notice,
  tutorReady,
  onRecap,
  onReview,
  onClose,
}: {
  notice: OpeningNotice;
  /** Whether the tutor can take a request now. */
  tutorReady: boolean;
  onRecap(): void;
  onReview(): void;
  onClose(): void;
}) {
  const { resume, due } = notice;
  const duePill = due > 0 ? (
    <button
      type="button"
      onClick={onReview}
      title="Start reviewing"
      className="press inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-label text-fog transition-colors duration-[var(--duration-fast)] hover:bg-white/[0.06] hover:text-paper"
    >
      <RotateCcw className="size-3.5" aria-hidden />
      {cardsDue(due)}
    </button>
  ) : null;

  if (!resume) {
    return (
      <div className="animate-rise absolute bottom-12 left-1/2 z-30 flex -translate-x-1/2 items-center rounded-full bg-panel-raised py-0.5 pl-1.5 pr-0.5 shadow-float ring-1 ring-white/[0.06]">
        {duePill}
        <IconButton label="Dismiss" size="sm" onClick={onClose}>
          <X />
        </IconButton>
      </div>
    );
  }

  return (
    <section
      aria-label="Where you left off"
      className="animate-rise absolute bottom-12 left-1/2 z-30 w-[min(520px,calc(100%-24px))] -translate-x-1/2 rounded-lg bg-panel-raised p-3 shadow-float ring-1 ring-white/[0.06]"
    >
      <div className="flex items-center gap-2">
        <h2 className="text-label font-medium text-paper">Where you left off</h2>
        <p className="min-w-0 flex-1 truncate text-label text-dim">
          {[resume.chapter, `${Math.round(resume.fraction * 100)}%`].filter(Boolean).join(" · ")}
        </p>
        <IconButton label="Dismiss (Esc)" size="sm" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      {resume.glimpse ? (
        <p className="mt-2 line-clamp-4 font-reading text-[13px] leading-relaxed text-fog/60 [overflow-wrap:anywhere]">{resume.glimpse}</p>
      ) : null}
      {resume.marks.length ? (
        <ul className="mt-2.5 flex flex-col gap-1">
          {resume.marks.map((mark) => (
            <li key={mark.id} className="flex items-start gap-2 text-label leading-snug text-fog">
              {mark.kind === "note" ? (
                <NotebookPen className="mt-px size-3.5 shrink-0 text-dim" aria-label="Note" />
              ) : (
                <Highlighter className="mt-px size-3.5 shrink-0 text-warn/80" aria-label="Highlight" />
              )}
              <span className="line-clamp-2 min-w-0 [overflow-wrap:anywhere]">{mark.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex items-center gap-1">
        <Button size="sm" disabled={!tutorReady} title={tutorReady ? "Ask the tutor for a short recap up to here" : "The tutor isn't available"} onClick={onRecap}>
          Recap
        </Button>
        <span className="flex-1" />
        {duePill}
      </div>
    </section>
  );
}
