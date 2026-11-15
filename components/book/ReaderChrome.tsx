"use client";

import Link from "next/link";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, FileWarning, X } from "lucide-react";
import type { OpenFailure } from "@/components/reader/errors";
import { EmptyState } from "@/components/ui";

/** A quiet strip along the reader's left or right edge that turns the page in Pages mode. */
export function PageTurn({ direction, onTurn }: { direction: 1 | -1; onTurn(direction: 1 | -1): void }) {
  const Icon = direction === 1 ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      aria-label={direction === 1 ? "Next page" : "Previous page"}
      title={direction === 1 ? "Next page (→)" : "Previous page (←)"}
      onClick={() => onTurn(direction)}
      className={clsx(
        "group absolute inset-y-0 z-20 flex w-10 items-center justify-center text-page-dim/70 outline-none transition-colors duration-[var(--duration-fast)] hover:bg-prose/[0.03] hover:text-prose focus-visible:text-prose",
        direction === 1 ? "right-0" : "left-0",
      )}
    >
      <Icon className="size-5 transition-transform duration-[var(--duration-fast)] group-active:scale-90" />
    </button>
  );
}

/** The way out of the spotlight, in the corner of the page, since the header is gone. */
export function SpotlightExit({ shortcut, onExit }: { shortcut: string; onExit(): void }) {
  return (
    <button
      type="button"
      onClick={onExit}
      title={`Leave the spotlight (Esc or ${shortcut})`}
      className="press animate-rise absolute right-3 top-3 z-30 inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-label text-page-dim/70 transition-colors duration-[var(--duration-fast)] hover:bg-prose/[0.06] hover:text-prose focus-visible:text-prose"
    >
      <X className="size-3.5" aria-hidden />
      Esc
    </button>
  );
}

/** Shown in place of the book when it could not be opened. */
export function OpenFailed({ failure }: { failure: OpenFailure }) {
  return (
    <EmptyState icon={<FileWarning />} title="This book could not be opened" body={failure.message}>
      {failure.detail ? <p className="mt-2 max-w-[48ch] font-mono text-[11px] leading-relaxed text-dim/80 [overflow-wrap:anywhere]">{failure.detail}</p> : null}
      <Link href="/" className="press mt-3 rounded-full bg-accent px-3.5 py-1.5 text-label font-semibold text-on-accent transition-colors duration-[var(--duration-fast)] hover:bg-accent/90">
        Back to library
      </Link>
    </EmptyState>
  );
}
