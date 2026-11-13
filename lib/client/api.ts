import type { AppSettings, BookId, Position } from "@/lib/shared/types";

interface StatePatch {
  position?: Position;
  meta?: { title: string; author: string | null };
}

/** Saves part of a book's state. `keepalive` lets the request finish while the page unloads. */
export const patchBookState = (bookId: BookId, patch: StatePatch, keepalive = false) =>
  fetch(`/api/books/${bookId}/state`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
    keepalive,
  }).catch(() => undefined);

/** Saves app settings the reader changed, such as the tutor or the PDF dark pages switch. */
export const patchSettings = (change: Partial<Pick<AppSettings, "provider" | "pdfDarkPages">>) =>
  fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(change),
  }).catch(() => undefined);
