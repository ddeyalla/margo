"use client";

import { useCallback, useEffect, useRef } from "react";
import { patchBookState } from "@/lib/client/api";
import type { BookId, Position } from "@/lib/shared/types";

/** Quiet time after the last scroll before the position is written. */
const SAVE_DELAY_MS = 800;

/** Returns `save`, which records the reading position and writes it after scrolling settles and when the page hides, and `flush`, which writes a pending one now. */
export function usePositionSaver(bookId: BookId) {
  const pending = useRef<Position | null>(null);
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
      pending.current = position;
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(false), SAVE_DELAY_MS);
    },
    [flush],
  );
  const flushNow = useCallback(() => flush(false), [flush]);
  return { save, flush: flushNow };
}
