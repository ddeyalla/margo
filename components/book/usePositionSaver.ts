"use client";

import { useCallback, useEffect, useRef } from "react";
import { patchBookState } from "@/lib/client/api";
import type { BookId, Position } from "@/lib/shared/types";

/** Quiet time after the last scroll before the position is written. */
const SAVE_DELAY_MS = 800;

/** Returns a function that records the reading position, saving it after scrolling settles and when the page hides. */
export function usePositionSaver(bookId: BookId) {
  const pending = useRef<Position | null>(null);
  const timer = useRef(0);

  const flush = useCallback(
    (keepalive: boolean) => {
      clearTimeout(timer.current);
      const position = pending.current;
      if (!position) return;
      pending.current = null;
      void patchBookState(bookId, { position }, keepalive);
    },
    [bookId],
  );

  useEffect(() => {
    const onHide = () => flush(true);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush(true);
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      flush(true);
    };
  }, [flush]);

  return useCallback(
    (position: Position) => {
      pending.current = position;
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => flush(false), SAVE_DELAY_MS);
    },
    [flush],
  );
}
