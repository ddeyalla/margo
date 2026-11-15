"use client";

import { useCallback, useEffect, useRef } from "react";
import { patchBookState } from "@/lib/client/api";
import type { BookId, Position } from "@/lib/shared/types";

/** Quiet time after the last scroll before the position is written. */
const SAVE_DELAY_MS = 800;

/* A PDF reopens a hair off where it was saved, because page heights are measured again; that is still the same place. */
const samePosition = (a: Position, b: Position | null): boolean =>
  b !== null &&
  (a.kind === "epub"
    ? b.kind === "epub" && a.cfi === b.cfi
    : b.kind === "pdf" && a.page === b.page && Math.abs(a.offset - b.offset) < 0.01);

/**
 * Returns `save`, which records the reading position and writes it after scrolling settles and when the page hides, and `flush`, which writes a pending one now.
 * The position the book opened at is never written back: on a reload that write can land after the previous page's last save and undo it.
 */
export function usePositionSaver(bookId: BookId, opened: Position | null) {
  const pending = useRef<Position | null>(null);
  const known = useRef(opened);
  const timer = useRef(0);
  /* The latest write, so a caller that flushes can wait for one that something else already started. */
  const inflight = useRef<Promise<unknown>>(Promise.resolve());

  const flush = useCallback(
    (keepalive: boolean) => {
      clearTimeout(timer.current);
      const position = pending.current;
      if (position) {
        pending.current = null;
        inflight.current = patchBookState(bookId, { position }, keepalive);
      }
      return inflight.current;
    },
    [bookId],
  );

  useEffect(() => {
    const onHide = () => void flush(true);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flush(true);
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      void flush(true);
    };
  }, [flush]);

  const save = useCallback(
    (position: Position) => {
      if (samePosition(position, known.current)) return;
      known.current = position;
      pending.current = position;
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(false), SAVE_DELAY_MS);
    },
    [flush],
  );
  const flushNow = useCallback(() => flush(false), [flush]);
  return { save, flush: flushNow };
}
