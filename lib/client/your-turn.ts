import { useSyncExternalStore } from "react";
import { YOUR_TURN_SKIPS } from "@/lib/shared/study";

/*
 * The "Your turn" prompts an Ask answer may close with, for this session of the app. A prompt is on offer from the
 * moment its answer finishes. Taking it opens Go deeper; dismissing it, or sending the tutor anything else while it
 * is on offer, passes it over. After two are passed over, no more are shown until the app is opened again.
 */

interface YourTurn {
  /** The thread whose prompt is on offer and not yet taken or passed over. */
  offered: string | null;
  /** Threads whose prompt was taken or passed over; it isn't shown again. */
  settled: string[];
  skips: number;
}

const KEY = "margo:your-turn";

const read = (): YourTurn => {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Partial<YourTurn> | null;
    if (value && Array.isArray(value.settled) && typeof value.skips === "number") {
      return { offered: typeof value.offered === "string" ? value.offered : null, settled: value.settled.filter((id) => typeof id === "string"), skips: value.skips };
    }
  } catch {
    /* No storage, or nothing readable in it: the session starts fresh. */
  }
  return { offered: null, settled: [], skips: 0 };
};

let current: YourTurn | null = null;
const listeners = new Set<() => void>();

const state = (): YourTurn => (current ??= read());

const save = (next: YourTurn) => {
  current = next;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* The count then lasts until the page reloads. */
  }
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const settle = (threadId: string, skipped: boolean) => {
  const current = state();
  if (current.settled.includes(threadId)) return;
  save({ offered: current.offered === threadId ? null : current.offered, settled: [...current.settled, threadId], skips: current.skips + (skipped ? 1 : 0) });
};

/** An answer just closed with a prompt. One still on offer from before was passed over. */
export const offerYourTurn = (threadId: string) => {
  passYourTurn();
  save({ ...state(), offered: threadId });
};

/** The reader went on without the prompt on offer, if there is one. */
export const passYourTurn = () => {
  const { offered } = state();
  if (offered) settle(offered, true);
};

/** The reader dismissed a thread's prompt. Only one on offer in this session counts toward the limit. */
export const dismissYourTurn = (threadId: string) => settle(threadId, state().offered === threadId);

/** The reader took a thread's prompt. */
export const takeYourTurn = (threadId: string) => settle(threadId, false);

/** Whether a thread's prompt should show: not yet taken or passed over, and the session not past its skips. */
export const yourTurnShown = (threadId: string): boolean => state().skips < YOUR_TURN_SKIPS && !state().settled.includes(threadId);

/** `yourTurnShown`, kept up to date. Never true on the server, which can't know the session. */
export const useYourTurnShown = (threadId: string): boolean =>
  useSyncExternalStore(
    subscribe,
    () => yourTurnShown(threadId),
    () => false,
  );
