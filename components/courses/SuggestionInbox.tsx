"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui";
import { decideSuggestion } from "@/lib/client/api";
import type { PendingSuggestion } from "@/lib/server/suggestions";
import type { CardSuggestion, Decision, PlanSuggestion } from "@/lib/shared/suggestions";

/** How many suggestions are laid out at once; the rest follow as these are decided. */
const SHOWN = 3;

type Pending<T> = T & { bookTitle: string | null };

/** Sends the reader's yes or no, and keeps the row busy until the refreshed page drops it. */
function useDecision(id: string) {
  const router = useRouter();
  const [busy, setBusy] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decide = async (decision: Decision) => {
    setBusy(decision);
    setError(null);
    const message = await decideSuggestion(id, decision);
    if (message) {
      setBusy(null);
      return setError(message);
    }
    /* The row stays busy until the refreshed page drops it. */
    router.refresh();
  };
  return { busy, error, decide };
}

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

function PlanRow({ suggestion }: { suggestion: Pending<PlanSuggestion> }) {
  const { busy, error, decide } = useDecision(suggestion.id);
  const { payload } = suggestion;
  return (
    <li className="flex flex-col gap-3 rounded-lg bg-panel-raised p-4 shadow-chip">
      <div className="flex flex-col gap-1">
        <p className="text-label text-dim [overflow-wrap:anywhere]">
          Prepared for {payload.forDay} · from {suggestion.proposer}
        </p>
        {payload.note ? <p className="text-body text-paper [overflow-wrap:anywhere]">{payload.note}</p> : null}
      </div>
      {payload.retest.length ? (
        <div className="flex flex-col gap-1">
          <p className="text-label font-medium text-dim">To check again</p>
          <ul className="flex flex-col gap-1">
            {payload.retest.map((item, index) => (
              <li key={index} className="text-body [overflow-wrap:anywhere]">
                <span className="text-paper">{item.topic}</span> <span className="text-dim">{[item.bookTitle, item.chapter, item.why].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {payload.exercises.length ? (
        <div className="flex flex-col gap-1">
          <p className="text-label font-medium text-dim">{count(payload.exercises.length, "exercise", "exercises")}</p>
          <ul className="flex flex-col gap-1">
            {payload.exercises.map((item, index) => (
              <li key={index} className="text-body [overflow-wrap:anywhere]">
                <span className="text-paper">{item.prompt}</span> <span className="text-dim">{[item.bookTitle, item.chapter].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {payload.questions.length ? (
        <div className="flex flex-col gap-1">
          <p className="text-label font-medium text-dim">{count(payload.questions.length, "open question", "open questions")}</p>
          <ul className="flex flex-col gap-1">
            {payload.questions.map((item, index) => (
              <li key={index} className="text-body [overflow-wrap:anywhere]">
                <span className="text-paper">{item.question}</span> <span className="text-dim">{item.bookTitle}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy !== null} onClick={() => void decide("accept")}>
          <Check aria-hidden />
          {busy === "accept" ? "Saving…" : "Got it"}
        </Button>
        <Button variant="ghost" disabled={busy !== null} onClick={() => void decide("reject")}>
          <X aria-hidden />
          Dismiss
        </Button>
        {error ? (
          <span role="alert" className="text-label text-danger">
            {error}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function CardRow({ suggestion }: { suggestion: Pending<CardSuggestion> }) {
  const { busy, error, decide } = useDecision(suggestion.id);
  const { payload } = suggestion;
  const where = [suggestion.bookTitle ?? "A book no longer in the library", payload.chapterTitle].filter(Boolean).join(" · ");
  return (
    <li className="flex flex-col gap-3 rounded-lg bg-panel-raised p-4 shadow-chip">
      <div className="flex flex-col gap-1">
        <p className="text-label text-dim [overflow-wrap:anywhere]">
          Review card · {where} · from {suggestion.proposer}
        </p>
        <p className="text-body text-paper [overflow-wrap:anywhere]">{payload.fact}</p>
      </div>
      <ul className="flex flex-col gap-1.5">
        {payload.cards.map((card) => (
          <li key={card.question} className="text-body [overflow-wrap:anywhere]">
            <span className="text-paper">{card.question}</span> <span className="text-dim">{card.answer}</span>
          </li>
        ))}
      </ul>
      {payload.failed?.length ? (
        <div className="flex flex-col gap-1">
          <p className="text-label text-dim">
            Left out: {payload.failed.length === 1 ? "1 card" : `${payload.failed.length} cards`} didn’t hold up when checked against the passage.
          </p>
          <ul className="flex flex-col gap-1">
            {payload.failed.map((card) => (
              <li key={card.question} className="text-label text-dim [overflow-wrap:anywhere]">
                <s>{card.question}</s> {card.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy !== null} onClick={() => void decide("accept")}>
          <Check aria-hidden />
          {busy === "accept" ? "Adding…" : payload.cards.length === 1 ? "Add card" : `Add ${payload.cards.length} cards`}
        </Button>
        <Button variant="ghost" disabled={busy !== null} onClick={() => void decide("reject")}>
          <X aria-hidden />
          Reject
        </Button>
        {error ? (
          <span role="alert" className="text-label text-danger">
            {error}
          </span>
        ) : null}
      </div>
    </li>
  );
}

const SuggestionRow = ({ suggestion }: { suggestion: PendingSuggestion }) =>
  suggestion.kind === "plan" ? <PlanRow suggestion={suggestion as Pending<PlanSuggestion>} /> : <CardRow suggestion={suggestion as Pending<CardSuggestion>} />;

/** What agents proposed while the reader was away, each waiting for a yes or a no. Nothing here is in the books yet. */
export function SuggestionInbox({ suggestions }: { suggestions: PendingSuggestion[] }) {
  if (!suggestions.length) return null;
  const more = suggestions.length - SHOWN;
  return (
    <section aria-label="Suggestions" className="flex flex-col gap-2">
      <h3 className="text-label font-medium text-dim">
        {suggestions.length === 1 ? "1 suggestion waiting" : `${suggestions.length} suggestions waiting`}
      </h3>
      <ul className="flex flex-col gap-2">
        {suggestions.slice(0, SHOWN).map((suggestion) => (
          <SuggestionRow key={suggestion.id} suggestion={suggestion} />
        ))}
      </ul>
      {more > 0 ? <p className="text-label text-dim">{more} more after these.</p> : null}
    </section>
  );
}
