"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ReaderHandle } from "@/components/reader/types";
import { applyChange, CHANGE_METHODS, type AnnotationChange, type Passage } from "@/lib/shared/annotations";
import type { Annotations, BookId, SelectionContext, VaultStatus } from "@/lib/shared/types";

interface Pending {
  seq: number;
  change: AnnotationChange;
  at: string;
}

const passageOf = (selection: SelectionContext): Passage => ({
  id: crypto.randomUUID(),
  anchor: selection.anchor,
  quote: selection.text,
  chapterTitle: selection.chapterTitle,
});

/**
 * The book's highlights and notes. What's shown is the server's last answer
 * with every unsaved change replayed on top through the same reducer the
 * server runs, so a change appears at once and a failed save simply drops
 * out. Changes go to the server one at a time, in order.
 */
export function useAnnotations(bookId: BookId, initial: Annotations, reader: RefObject<ReaderHandle | null>) {
  const [saved, setSaved] = useState(initial);
  const [pending, setPending] = useState<Pending[]>([]);
  const [vault, setVault] = useState<VaultStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const seq = useRef(0);

  const shown = useMemo(() => pending.reduce((state, p) => applyChange(state, p.change, p.at), saved), [saved, pending]);

  const drawn = useRef(new Set<string>());
  useEffect(() => {
    const handle = reader.current;
    if (!handle) return;
    const next = new Set(shown.highlights.map((h) => h.id));
    for (const id of drawn.current) if (!next.has(id)) handle.removeHighlight(id);
    for (const highlight of shown.highlights) if (!drawn.current.has(highlight.id)) handle.showHighlight(highlight);
    drawn.current = next;
  }, [shown.highlights, reader]);

  const send = useCallback(
    (change: AnnotationChange) => {
      const entry: Pending = { seq: ++seq.current, change, at: new Date().toISOString() };
      setPending((current) => [...current, entry]);
      setError(null);
      queue.current = queue.current.then(async () => {
        try {
          const response = await fetch(`/api/books/${bookId}/annotations`, {
            method: CHANGE_METHODS[change.op],
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(change),
          });
          const body: unknown = await response.json().catch(() => null);
          if (!response.ok || !body || typeof body !== "object" || !("annotations" in body)) {
            const message = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : null;
            throw new Error(message ?? `The change could not be saved (${response.status}).`);
          }
          const result = body as { annotations: Annotations; vault: VaultStatus };
          setSaved(result.annotations);
          /* A notes-folder failure shows on the Notes and Highlights tabs' vault line, not as an error banner too. */
          setVault(result.vault);
        } catch (cause) {
          setError(cause instanceof Error && cause.message !== "Failed to fetch" ? cause.message : "The change could not be saved. Is the app still running?");
        } finally {
          setPending((current) => current.filter((p) => p.seq !== entry.seq));
        }
      });
    },
    [bookId],
  );

  const dismissError = useCallback(() => setError(null), []);
  const highlight = useCallback((selection: SelectionContext) => send({ op: "add-highlight", highlight: passageOf(selection) }), [send]);
  const removeHighlight = useCallback((id: string) => send({ op: "remove-highlight", id }), [send]);
  const addNote = useCallback(
    (selection: SelectionContext, body: string) => send({ op: "add-note", note: { ...passageOf(selection), body }, highlightId: crypto.randomUUID() }),
    [send],
  );
  const editNote = useCallback((id: string, body: string) => send({ op: "edit-note", id, body }), [send]);
  const removeNote = useCallback((id: string) => send({ op: "remove-note", id }), [send]);

  return useMemo(
    () => ({
      highlights: shown.highlights,
      notes: shown.notes,
      /** The markdown copy's state after the last saved change; null until something changes. */
      vault,
      error,
      dismissError,
      highlight,
      removeHighlight,
      addNote,
      editNote,
      removeNote,
    }),
    [shown, vault, error, dismissError, highlight, removeHighlight, addNote, editNote, removeNote],
  );
}

export type AnnotationsApi = ReturnType<typeof useAnnotations>;
