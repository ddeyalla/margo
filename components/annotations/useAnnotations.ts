"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
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

  /* The reader draws what's shown: new highlights appear, removed ones go. */
  const drawn = useRef(new Set<string>());
  useEffect(() => {
    const handle = reader.current;
    if (!handle) return;
    const next = new Set(shown.highlights.map((h) => h.id));
    for (const id of drawn.current) if (!next.has(id)) handle.removeHighlight(id);
    for (const highlight of shown.highlights) if (!drawn.current.has(highlight.id)) handle.showHighlight(highlight);
    drawn.current = next;
  }, [shown.highlights, reader]);

  const send = (change: AnnotationChange) => {
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
        setVault(result.vault);
        if (result.vault.state === "failed") setError(`Saved in the app, but not copied to your notes folder. ${result.vault.error}`);
      } catch (cause) {
        setError(cause instanceof Error && cause.message !== "Failed to fetch" ? cause.message : "The change could not be saved. Is the app still running?");
      } finally {
        setPending((current) => current.filter((p) => p.seq !== entry.seq));
      }
    });
  };

  return {
    highlights: shown.highlights,
    notes: shown.notes,
    /** The markdown copy's state after the last saved change; null until something changes. */
    vault,
    error,
    dismissError: () => setError(null),
    highlight(selection: SelectionContext) {
      send({ op: "add-highlight", highlight: passageOf(selection) });
    },
    removeHighlight(id: string) {
      send({ op: "remove-highlight", id });
    },
    addNote(selection: SelectionContext, body: string) {
      send({ op: "add-note", note: { ...passageOf(selection), body }, highlightId: crypto.randomUUID() });
    },
    editNote(id: string, body: string) {
      send({ op: "edit-note", id, body });
    },
    removeNote(id: string) {
      send({ op: "remove-note", id });
    },
  };
}

export type AnnotationsApi = ReturnType<typeof useAnnotations>;
