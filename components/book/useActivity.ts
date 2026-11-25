"use client";

import { useEffect, useRef } from "react";
import type { ActivityKind } from "@/lib/shared/mastery";
import type { BookId } from "@/lib/shared/types";
import type { PlaceStore } from "./place";

/** With no input for this long, the reader is taken to be away and time stops counting. */
const IDLE_MS = 2 * 60 * 1000;
/** How often counted time is sent. */
const REPORT_MS = 30 * 1000;

const EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "scroll", "touchstart"] as const;

/**
 * Counts the seconds this book is open, in view and in use, as reading, review or quiz time, and sends them about
 * every half minute and when the page is hidden or left. A move in the book counts as use too: an EPUB page lives
 * in a frame whose own clicks and keys the window never hears.
 */
export function useActivity(bookId: BookId, kind: ActivityKind, spot: PlaceStore) {
  const current = useRef(kind);
  useEffect(() => {
    current.current = kind;
  }, [kind]);

  useEffect(() => {
    let lastUse = Date.now();
    const pending: Partial<Record<ActivityKind, number>> = {};
    const used = () => {
      lastUse = Date.now();
    };
    const send = () => {
      for (const [name, seconds] of Object.entries(pending) as [ActivityKind, number][]) {
        if (!seconds) continue;
        delete pending[name];
        /* keepalive lets a report sent as the page goes still arrive; unlike a beacon it carries the Origin header. */
        void fetch("/api/activity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookId, kind: name, seconds }),
          keepalive: true,
        }).catch(() => {});
      }
    };
    const tick = setInterval(() => {
      if (document.visibilityState !== "visible" || Date.now() - lastUse > IDLE_MS) return;
      pending[current.current] = (pending[current.current] ?? 0) + 1;
    }, 1000);
    const report = setInterval(send, REPORT_MS);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") send();
      else used();
    };
    for (const name of EVENTS) window.addEventListener(name, used, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", send);
    const unsubscribe = spot.subscribe(used);
    return () => {
      clearInterval(tick);
      clearInterval(report);
      for (const name of EVENTS) window.removeEventListener(name, used, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", send);
      unsubscribe();
      send();
    };
  }, [bookId, spot]);
}
