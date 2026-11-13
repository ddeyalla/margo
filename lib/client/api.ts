import type { BookId, Position, SettingsChange } from "@/lib/shared/types";

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
