"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { useStore } from "@/components/ui/store";
import { minutesLeftLabel } from "@/lib/shared/reading-time";
import type { PlaceStore } from "./place";
import { pageLabel, pagesLeftLabel, percentLabel } from "./progress";

/** How far each key moves the progress bar. */
const SEEK_KEYS: Record<string, (fraction: number) => number> = {
  ArrowRight: (f) => f + 0.01,
  ArrowUp: (f) => f + 0.01,
  ArrowLeft: (f) => f - 0.01,
  ArrowDown: (f) => f - 0.01,
  PageUp: (f) => f + 0.1,
  PageDown: (f) => f - 0.1,
  Home: () => 0,
  End: () => 1,
};

const clamp = (fraction: number) => Math.min(1, Math.max(0, fraction));

const fractionAt = (event: PointerEvent<HTMLElement>) => {
  const box = event.currentTarget.getBoundingClientRect();
  return clamp((event.clientX - box.left) / Math.max(1, box.width));
};

/**
 * A slim progress bar along the bottom of the book, with the page, what's left
 * of the chapter and how far through the book you are. Click or drag the bar
 * to jump; the jump happens when you let go.
 */
export function ReadingFooter({ spot, onSeek }: { spot: PlaceStore; onSeek(fraction: number): void }) {
  const current = useStore(spot, (value) => value);
  const fraction = current?.position.fraction ?? 0;
  const place = current?.place ?? null;
  /* Where a drag on the bar would land, while it lasts. */
  const [dragAt, setDragAt] = useState<number | null>(null);
  /* Where a drag let go, held until the book reports a new place so the bar doesn't jump back meanwhile. */
  const [released, setReleased] = useState<{ value: number; from: number } | null>(null);
  const shown = dragAt ?? (released && released.from === fraction ? released.value : fraction);
  const page = place?.page ? pageLabel(place.page) : null;
  const pagesLeft = place?.pagesLeftInChapter != null ? pagesLeftLabel(place.pagesLeftInChapter) : null;
  const minutes = place?.minutesLeftInChapter;
  /* Beside a page count the minutes drop "in chapter", which the count already says. */
  const timeLeft = minutes == null ? null : pagesLeft && minutes > 0 ? `about ${minutes} min` : minutesLeftLabel(minutes);
  const left = [pagesLeft, timeLeft].filter(Boolean).join(" · ") || null;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const step = SEEK_KEYS[event.key];
    if (!step || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    setReleased(null);
    onSeek(clamp(step(fraction)));
  };

  return (
    <footer className="relative shrink-0 bg-page">
      <div
        role="slider"
        tabIndex={0}
        aria-label="Reading progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(shown * 100)}
        aria-valuetext={[percentLabel(shown), page].filter(Boolean).join(", ")}
        data-dragging={dragAt !== null || undefined}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragAt(fractionAt(event));
        }}
        onPointerMove={(event) => {
          if (dragAt !== null) setDragAt(fractionAt(event));
        }}
        onPointerUp={(event) => {
          if (dragAt === null) return;
          const value = fractionAt(event);
          setReleased({ value, from: fraction });
          onSeek(value);
        }}
        onLostPointerCapture={() => setDragAt(null)}
        onKeyDown={onKeyDown}
        className="group absolute inset-x-0 -top-1.5 z-20 h-3 cursor-pointer touch-none outline-none"
      >
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-page-dim/20 transition-[height] duration-[var(--duration-fast)] ease-out group-hover:h-1 group-focus-visible:h-1 group-data-[dragging]:h-1">
          <div className="h-full bg-page-dim" style={{ width: `${shown * 100}%` }} />
        </div>
      </div>
      <div className="flex h-8 items-center gap-4 px-4 text-label text-page-dim tabular-nums">
        <span className="shrink-0">{page}</span>
        <span className="min-w-0 flex-1 truncate text-center">{left}</span>
        <span className="shrink-0">{percentLabel(shown)}</span>
      </div>
    </footer>
  );
}
