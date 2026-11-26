"use client";

import { Shapes, X } from "lucide-react";
import clsx from "clsx";

const chip = "flex min-w-0 max-w-full items-center gap-1.5 rounded-md bg-panel-hover py-1 pl-2 text-label ring-1 ring-inset ring-line";

/** The whiteboard a sent message was about, above its words. */
export function SentBoard({ title }: { title: string }) {
  return (
    <span className={clsx(chip, "pr-2")} title="Sent with the board as it was then">
      <Shapes className="size-3 shrink-0 text-dim" aria-hidden />
      <span className="min-w-0 truncate text-prose">{title}</span>
    </span>
  );
}

/**
 * The open whiteboard, attached to the message being written: the tutor reads the board with it, and anything it
 * changes comes back on the board as suggestions. Removed, the message goes without it.
 */
export function DraftBoard({ title, onRemove }: { title: string; onRemove(): void }) {
  return (
    <div className="px-3 pt-3">
      <span className={clsx(chip, "w-fit pr-0.5")} title="The tutor reads the board with this message, and its changes land on the board for you to keep or drop">
        <Shapes className="size-3 shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 truncate text-prose">{title}</span>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Send without the whiteboard"
          title="Send without the board"
          className="press grid size-5 shrink-0 place-items-center rounded-sm text-dim transition-colors duration-[var(--duration-fast)] hover:bg-tint hover:text-paper focus-visible:outline-2 focus-visible:outline-accent"
        >
          <X className="size-3" aria-hidden />
        </button>
      </span>
    </div>
  );
}
