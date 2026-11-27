"use client";

import { useEffect, useState } from "react";
import type { SelectionRect } from "@/components/reader/types";
import type { Glance } from "@/lib/shared/glance";
import type { ProviderId } from "@/lib/shared/types";

export interface GlanceAsk {
  term: string;
  sentence: string;
  rect: SelectionRect;
}

const CARD_WIDTH = 300;

/**
 * The hover glance (a spike): a small card under the word, with its meaning in this sentence and one example.
 * It says whether the sentence is teaching the idea, since that is where a glance may cost recall.
 */
export function GlanceCard({ bookId, ask, provider }: { bookId: string; ask: GlanceAsk; provider: ProviderId }) {
  const [glance, setGlance] = useState<Glance | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    /* The workspace keys this card by its word, so a new word starts with an empty card. */
    const controller = new AbortController();
    fetch(`/api/books/${bookId}/glance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term: ask.term, sentence: ask.sentence, provider }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as Glance & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "The glance failed.");
        setGlance(body);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "The glance failed.");
      });
    return () => controller.abort();
  }, [bookId, ask.term, ask.sentence, provider]);

  const left = Math.max(12, Math.min(ask.rect.left, window.innerWidth - CARD_WIDTH - 12));
  const below = ask.rect.top + ask.rect.height + 8;
  const top = below + 160 > window.innerHeight ? Math.max(12, ask.rect.top - 168) : below;
  return (
    <div
      role="tooltip"
      style={{ position: "fixed", left, top, width: CARD_WIDTH }}
      className="animate-rise pointer-events-none z-50 rounded-lg bg-panel-raised p-3 text-label text-fog shadow-float"
    >
      <p className="font-medium text-paper">{ask.term}</p>
      {error ? (
        <p className="mt-1">{error}</p>
      ) : glance ? (
        <>
          <p className="mt-1 text-paper">{glance.gist}</p>
          <p className="mt-2 text-dim">e.g. {glance.example}</p>
          {glance.core ? <p className="mt-2 text-[11px] text-dim">This passage teaches this idea. Try to say it in your own words before you read on.</p> : null}
        </>
      ) : (
        <p className="mt-1 text-dim">Looking…</p>
      )}
    </div>
  );
}
