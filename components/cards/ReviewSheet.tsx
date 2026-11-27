"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { BookModal } from "@/components/ui/dialog";
import { ratedRight, signalOf, type Signal } from "@/lib/shared/confidence";
import { intervalLabel, nextLearningAt, reviewQueue } from "@/lib/shared/schedule";
import type { Anchor, BookId, CardSet, ProviderId, Rating, Stance } from "@/lib/shared/types";
import { ItemCard } from "./ItemCard";
import { SignalSummary } from "./Stance";
import type { CardsApi } from "./useCards";

/**
 * Reviews the book's due items over the reader, as many as the day's limit lets through. Each is answered the way
 * its type asks; Space shows a flipped answer, 1 to 4 rate it, Escape closes. Keys typed into a text field are left alone; the book
 * holds back its own shortcuts while the sheet is open.
 */
export function ReviewSheet({ bookId, cards, provider, onClose, onJump }: { bookId: BookId; cards: CardsApi; provider: ProviderId | null; onClose(): void; onJump(anchor: Anchor): void }) {
  const [now, setNow] = useState(() => new Date());
  const [done, setDone] = useState(0);
  /* What each rating this session meant, for the summary at the end. */
  const [seen, setSeen] = useState<{ question: string; signal: Signal | null }[]>([]);
  const queue = reviewQueue(cards.sets, now, cards.load);
  const head = queue[0];
  const comeBack = head ? null : nextLearningAt(cards.sets, now);

  /* A learning step comes due while the sheet is open: wake up for it. */
  useEffect(() => {
    if (!comeBack) return;
    const timer = setTimeout(() => setNow(new Date()), Math.max(0, comeBack.getTime() - Date.now()) + 250);
    return () => clearTimeout(timer);
  }, [comeBack]);

  const rate = (set: CardSet, cueId: string, rating: Rating, stance: Stance, aided: boolean) => {
    cards.change({ op: "review", setId: set.id, cueId, rating, reps: set.schedule.reps, ...(aided ? { aided } : {}), ...stance });
    const question = set.cues.find((cue) => cue.id === cueId)?.question ?? "";
    setSeen((list) => [...list, { question, signal: signalOf(ratedRight(rating), stance.confidence) }]);
    setDone((n) => n + 1);
    setNow(new Date());
  };

  return (
    <BookModal
      label="Review cards"
      heading={
        <>
          <span className="text-label text-fog tabular-nums">{head ? `${queue.length} left` : "Done"}</span>
          {done ? <span className="text-label text-dim tabular-nums">{done} reviewed</span> : null}
        </>
      }
      closeLabel="Close review (Escape)"
      veiled={!!head}
      typingKeepsEscape
      onClose={onClose}
    >
        {head ? (
          <ItemCard
            key={`${head.id}:${head.schedule.reps}`}
            bookId={bookId}
            set={head}
            now={now}
            provider={provider}
            onRate={(cueId, rating, stance, aided) => rate(head, cueId, rating, stance, aided)}
            onJump={(anchor) => {
              onClose();
              onJump(anchor);
            }}
          />
        ) : (
          <div className="flex max-w-[52ch] flex-col items-center gap-3 py-6 text-center">
            <p className="text-title font-medium text-paper">{done ? "That's all for now." : "Nothing to review."}</p>
            <p className="text-label leading-relaxed text-dim">
              {comeBack
                ? `A card you missed comes back in ${intervalLabel(now, comeBack)}. Keep this open or come back later.`
                : "New cards and due reviews show up here, a few each day. Make cards from any passage you select."}
            </p>
            <SignalSummary items={seen} />
            <Button onClick={onClose}>Close</Button>
          </div>
        )}
    </BookModal>
  );
}
