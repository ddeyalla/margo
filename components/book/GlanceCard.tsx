"use client";

import { useEffect, useState } from "react";
import type { SelectionRect } from "@/components/reader/types";
import { parseGlance } from "@/lib/shared/glance";

export interface GlanceAsk {
  term: string;
  sentence: string;
  rect: SelectionRect;
}

const CARD_WIDTH = 300;

/**
 * The hover glance (a spike): a small card under the word, with its meaning in this sentence and one example,
 * shown as it streams. It says when the passage is teaching the idea, since that is where a glance may cost recall.
 */
export function GlanceCard({ bookId, ask }: { bookId: string; ask: GlanceAsk }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    /* The workspace keys this card by its word, so a new word starts with an empty card. */
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/books/${bookId}/glance`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ term: ask.term, sentence: ask.sentence }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? "The glance failed.");
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let so = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          so += value;
          setText(so);
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "The glance failed.");
      }
    })();
    return () => controller.abort();
  }, [bookId, ask.term, ask.sentence]);

  const glance = parseGlance(text);
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
      ) : glance.gist ? (
        <>
          <p className="mt-1 text-paper">{glance.gist}</p>
          {glance.example ? <p className="mt-2 text-dim">e.g. {glance.example}</p> : null}
          {glance.core ? <p className="mt-2 text-[11px] text-dim">This passage teaches this idea. Try to say it in your own words before you read on.</p> : null}
        </>
      ) : (
        <p className="mt-1 text-dim">Looking…</p>
      )}
    </div>
  );
}
