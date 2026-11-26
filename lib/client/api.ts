import type { Decision } from "@/lib/shared/suggestions";
import type { Overrule, StudyThread } from "@/lib/shared/study";
import type { BookId, Position, ProviderId, SelectionContext, SettingsChange } from "@/lib/shared/types";

interface StatePatch {
  position?: Position;
  meta?: { title: string; author: string | null };
  activeThreadId?: string | null;
}

/** Saves part of a book's state. `keepalive` lets the request finish while the page unloads. */
export const patchBookState = (bookId: BookId, patch: StatePatch, keepalive = false) =>
  fetch(`/api/books/${bookId}/state`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
    keepalive,
  }).catch(() => undefined);

/** The font families installed on this Mac, sorted. */
export const fetchFonts = async (): Promise<string[]> => {
  const response = await fetch("/api/fonts");
  if (!response.ok) throw new Error(`Listing fonts failed with ${response.status}.`);
  const { families } = (await response.json()) as { families: string[] };
  return families;
};

/** Saves app settings the reader changed, such as the tutor, the reading mode or the page colours. */
export const patchSettings = (change: SettingsChange) =>
  fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(change),
  }).catch(() => undefined);

/** Sends a change the server may refuse. Returns its message when it does, otherwise null. */
const send = async (url: string, method: string, body: unknown, doing: string): Promise<string | null> => {
  try {
    const response = await fetch(url, {
      method,
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    if (response.ok) return null;
    const { error } = (await response.json().catch(() => ({}))) as { error?: string };
    return error ?? `${doing} failed with ${response.status}.`;
  } catch {
    return "Could not reach the app. Try again.";
  }
};

/** Saves the folders chosen in the app. Returns the server's message when it refuses one, otherwise null. */
export const saveFolders = (change: Pick<SettingsChange, "booksDir" | "notesDir">) => send("/api/settings", "PATCH", change, "Saving");

/** Gives a missing book's saved data to the file the library now calls `targetId`. Returns the server's message when it refuses, otherwise null. */
export const relinkBook = (id: BookId, targetId: BookId) => send("/api/library/missing", "POST", { id, targetId }, "Relinking");

/** Moves what the data folder keeps for a missing book to its forgotten folder. Returns the server's message when it refuses, otherwise null. */
export const forgetBook = (id: BookId) => send(`/api/library/missing/${id}`, "DELETE", undefined, "Forgetting");

/** Accepts or rejects a suggestion an agent proposed. Returns the server's message when it can't, otherwise null. */
export const decideSuggestion = (id: string, decision: Decision) => send("/api/suggestions", "POST", { id, decision }, decision === "accept" ? "Accepting" : "Rejecting");

/** One step of the reader's turn in Go deeper; see the study route for what each does. */
export type StudyRequest =
  | { op: "start"; provider: ProviderId; selection: Omit<SelectionContext, "rect"> }
  | { op: "start"; provider: ProviderId; from: string }
  | { op: "answer"; provider: ProviderId; threadId: string; answer: string }
  | { op: "draft"; threadId: string; draft: string }
  | { op: "overrule"; threadId: string; at: string; override: Overrule | null };

/** Sends a step of the reader's turn. Resolves to the saved thread, to the server's reason when it failed, or to null when `signal` stopped it. */
export const studyStep = async (bookId: BookId, step: StudyRequest, signal?: AbortSignal): Promise<{ thread: StudyThread } | { error: string } | null> => {
  try {
    const response = await fetch(`/api/books/${bookId}/study`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(step), signal });
    const body = (await response.json().catch(() => null)) as { thread?: StudyThread; error?: string } | null;
    if (response.ok && body?.thread) return { thread: body.thread };
    return { error: body?.error ?? `That failed with ${response.status}.` };
  } catch {
    return signal?.aborted ? null : { error: "Could not reach the app. Try again." };
  }
};
