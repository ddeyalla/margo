"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { changeCards, type CardChange } from "@/lib/shared/cards";
import type { BookId, CardSet, ProviderId, SelectionContext } from "@/lib/shared/types";

/** A passage the tutor is writing cards for. */
export interface CardJob {
  id: string;
  quote: string;
}

/** How long a notice that cards were or weren't added stays; errors stay until dismissed. */
const NOTICE_MS = 4000;

const METHOD: Record<CardChange["op"], "PATCH" | "DELETE"> = {
  "edit-cue": "PATCH",
  review: "PATCH",
  "delete-cue": "DELETE",
  "delete-set": "DELETE",
};

const readSets = async (response: Response): Promise<{ cardSets: CardSet[]; added?: number; reason?: string | null }> => {
  const body = (await response.json().catch(() => null)) as { cardSets?: CardSet[]; error?: string; added?: number; reason?: string | null } | null;
  if (!response.ok || !body?.cardSets) throw new Error(body?.error ?? `Saving cards failed with ${response.status}.`);
  return { cardSets: body.cardSets, added: body.added, reason: body.reason };
};

/** The cards the server holds, or null when it can't be reached. */
const fetchSets = async (bookId: BookId): Promise<CardSet[] | null> => {
  try {
    const response = await fetch(`/api/books/${bookId}/state`, { cache: "no-store" });
    return response.ok ? ((await response.json()) as { cardSets: CardSet[] }).cardSets : null;
  } catch {
    return null;
  }
};

/**
 * The book's card sets. Making cards waits on the tutor, so each passage shows
 * as a job until its answer comes back. Edits and reviews show at once, then
 * the server's answer replaces them; changes go out one at a time, in order.
 */
export function useCards(bookId: BookId, initial: CardSet[]) {
  const [sets, setSets] = useState(initial);
  const [jobs, setJobs] = useState<CardJob[]>([]);
  const [notice, setNotice] = useState<{ kind: "added" | "none" | "error"; text: string } | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  /* Changes sent but not yet answered. The server's answer only replaces what's shown once none are left, so a later change never flickers back. */
  const pending = useRef(0);

  useEffect(() => {
    if (!notice || notice.kind === "error") return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  /* Takes the server's cards once every change sent so far has been answered. */
  const refresh = useCallback(() => {
    pending.current++;
    queue.current = queue.current.then(async () => {
      const answer = await fetchSets(bookId);
      if (--pending.current === 0 && answer) setSets(answer);
    });
  }, [bookId]);

  const make = useCallback(
    async (selection: SelectionContext, provider: ProviderId) => {
      const job = { id: crypto.randomUUID(), quote: selection.text };
      setJobs((current) => [...current, job]);
      setNotice(null);
      try {
        const response = await fetch(`/api/books/${bookId}/cards`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            selection: { text: selection.text, before: selection.before, after: selection.after, anchor: selection.anchor, chapterTitle: selection.chapterTitle },
          }),
        });
        const { cardSets, added, reason } = await readSets(response);
        /* An edit or review still on its way is shown already; replacing the list now would undo it until its answer came. */
        if (pending.current === 0) setSets(cardSets);
        else refresh();
        setNotice(added ? { kind: "added", text: `Added ${added} ${added === 1 ? "card" : "cards"}.` } : { kind: "none", text: reason ?? "No cards for that passage." });
      } catch (error) {
        setNotice({ kind: "error", text: error instanceof Error ? error.message : "The tutor could not make cards." });
      } finally {
        setJobs((current) => current.filter((j) => j.id !== job.id));
      }
    },
    [bookId, refresh],
  );

  const change = useCallback(
    (next: CardChange) => {
      setSets((current) => changeCards(current, next, new Date()));
      pending.current++;
      queue.current = queue.current.then(async () => {
        let answer: CardSet[] | null = null;
        try {
          const response = await fetch(`/api/books/${bookId}/cards`, {
            method: METHOD[next.op],
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(next),
          });
          answer = (await readSets(response)).cardSets;
        } catch (error) {
          setNotice({ kind: "error", text: error instanceof Error ? error.message : "Saving the change failed." });
          /* The change was shown at once; take the server's cards back so the list shows what was really saved. */
          answer = await fetchSets(bookId);
        }
        if (--pending.current === 0 && answer) setSets(answer);
      });
    },
    [bookId],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  return useMemo(() => ({ sets, jobs, notice, dismissNotice, make, change }), [sets, jobs, notice, dismissNotice, make, change]);
}

export type CardsApi = ReturnType<typeof useCards>;
