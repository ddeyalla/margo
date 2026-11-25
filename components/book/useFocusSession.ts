"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { startFocusSession, stopFocusSession } from "@/lib/client/api";
import type { FocusBlocking } from "@/lib/shared/focus";
import type { BookId } from "@/lib/shared/types";
import type { TutorPanel } from "./useTutorPanel";

export type FocusSession =
  | { phase: "idle" }
  | { phase: "starting"; minutes: number }
  | { phase: "running"; minutes: number; endsAt: number; sessionId: string | null; blocking: FocusBlocking; panelWasOpen: boolean }
  | { phase: "done"; minutes: number; early: boolean };

type Running = Extract<FocusSession, { phase: "running" }>;

const storageKey = (bookId: BookId) => `rigg-learn:focus:${bookId}`;
const CHANGED = "rigg-learn:focus-changed";

/* The running session is kept in storage, so a refresh mid-session doesn't hand the reader back their distractions. */
const save = (bookId: BookId, session: Running | null) => {
  try {
    if (session) localStorage.setItem(storageKey(bookId), JSON.stringify(session));
    else localStorage.removeItem(storageKey(bookId));
  } catch {
    /* Storage can be off; the session just won't survive a reload. */
  }
  dispatchEvent(new Event(CHANGED));
};

const readSaved = (bookId: BookId): string | null => {
  try {
    return localStorage.getItem(storageKey(bookId));
  } catch {
    return null;
  }
};

const subscribe = (onChange: () => void) => {
  addEventListener(CHANGED, onChange);
  addEventListener("storage", onChange);
  return () => {
    removeEventListener(CHANGED, onChange);
    removeEventListener("storage", onChange);
  };
};

const parseSaved = (raw: string | null): Running | null => {
  try {
    const value = JSON.parse(raw ?? "null") as Running | null;
    return value?.phase === "running" && typeof value.endsAt === "number" ? { ...value, panelWasOpen: value.panelWasOpen === true } : null;
  } catch {
    return null;
  }
};

/**
 * A timed reading session: the chrome and the tutor fold away, Three blocks distractions if it can, and when time
 * is up the reader is asked to recall what they read. The tutor panel comes back afterwards if it was open.
 */
export function useFocusSession(bookId: BookId, title: string, panel: TutorPanel) {
  /* Starting and the recap are this page's own; a running session is whatever storage holds. */
  const [local, setLocal] = useState<Extract<FocusSession, { phase: "starting" | "done" }> | null>(null);
  const raw = useSyncExternalStore(subscribe, () => readSaved(bookId), () => null);
  const saved = useMemo(() => parseSaved(raw), [raw]);
  const [now, setNow] = useState(() => Date.now());
  const panelWasOpen = useRef(false);
  const folded = useRef(false);

  const running = !local && saved ? saved : null;
  const session: FocusSession = local ?? running ?? { phase: "idle" };

  /* Fold the tutor away for a session, including one picked up again after a reload. */
  useEffect(() => {
    if (!running || folded.current) return;
    /* The layout saves the folded panel too, so after a reload only the session remembers it was open. */
    folded.current = true;
    panelWasOpen.current = running.panelWasOpen;
    panel.collapse();
  }, [running, panel]);

  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const at = Date.now();
      setNow(at);
      if (at >= running.endsAt) {
        setLocal({ phase: "done", minutes: running.minutes, early: false });
        save(bookId, null);
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [running, bookId]);

  const start = async (minutes: number) => {
    if (session.phase === "starting" || session.phase === "running") return;
    folded.current = true;
    panelWasOpen.current = panel.isOpen();
    panel.collapse();
    setLocal({ phase: "starting", minutes });
    const started = await startFocusSession(title, minutes);
    const endsAt = (started.endsAt ? Date.parse(started.endsAt) : NaN) || Date.now() + minutes * 60_000;
    save(bookId, { phase: "running", minutes, endsAt, sessionId: started.sessionId, blocking: started.blocking, panelWasOpen: panelWasOpen.current });
    setNow(Date.now());
    setLocal(null);
  };

  /** Ends early, counting the whole minutes actually read. */
  const end = () => {
    if (!running) return;
    if (running.sessionId) void stopFocusSession(running.sessionId);
    const read = Math.max(0, Math.round((running.minutes * 60_000 - (running.endsAt - Date.now())) / 60_000));
    setLocal({ phase: "done", minutes: read, early: true });
    save(bookId, null);
  };

  /** Leaves the recap. `keepPanel` when the recap itself just opened the tutor. */
  const dismiss = (keepPanel = false) => {
    setLocal(null);
    folded.current = false;
    if (!keepPanel && panelWasOpen.current) panel.expand();
  };

  const remaining = running ? Math.max(0, running.endsAt - now) : 0;
  return { session, remaining, start, end, dismiss, active: session.phase !== "idle" };
}

/** 24:07, or 1:04:07 past an hour. */
export const formatRemaining = (ms: number) => {
  const total = Math.ceil(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
};
