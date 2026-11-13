"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { X } from "lucide-react";
import { Markdown } from "@/components/chat/Markdown";
import { Button, IconButton, Kbd } from "@/components/ui";
import { isTextEntry } from "@/lib/client/keys";
import { intervalLabel, nextLearningAt, pickCue, previewDue, reviewQueue } from "@/lib/shared/schedule";
import { RATINGS, type Anchor, type CardSet, type Rating } from "@/lib/shared/types";
import type { CardsApi } from "./useCards";

const LABELS: Record<Rating, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };

/* A fixed draw per showing, so the cue doesn't change on re-render but a set seen again can show another. */
const draw = (key: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return (hash >>> 0) / 2 ** 32;
};

function Card({ set, now, onRate, onJump }: { set: CardSet; now: Date; onRate(cueId: string, rating: Rating): void; onJump(anchor: Anchor): void }) {
  const [revealed, setRevealed] = useState(false);
  const cue = pickCue(set, draw(`${set.id}:${set.schedule.reps}:${set.schedule.lastReview ?? ""}`));
  const due = previewDue(set.schedule, now);

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (!revealed && (event.key === " " || event.key === "Enter")) {
      event.preventDefault();
      setRevealed(true);
      return;
    }
    const rating = revealed ? RATINGS[Number(event.key) - 1] : undefined;
    if (rating) {
      event.preventDefault();
      onRate(cue.id, rating);
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTextEntry(event.target)) return;
      onKey(event);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-5">
      <div className="text-[18px] font-medium leading-snug text-paper">
        <Markdown text={cue.question} />
      </div>
      {revealed ? (
        <div className="animate-rise flex flex-col gap-4">
          <div className="text-[14px] leading-relaxed text-prose">
            <Markdown text={cue.answer} />
          </div>
          <button type="button" onClick={() => onJump(set.anchor)} className="press text-left" title="Go to this passage">
            <span className="line-clamp-3 border-l border-line-strong pl-3 font-reading text-[12px] leading-relaxed text-dim">{set.quote}</span>
          </button>
          <div className="grid grid-cols-4 gap-2 pt-1">
            {RATINGS.map((rating, i) => (
              <Button key={rating} size="md" variant={rating === "good" ? "primary" : "outline"} onClick={() => onRate(cue.id, rating)} className="flex-col !h-auto gap-0.5 py-2">
                <span>{LABELS[rating]}</span>
                <span className="text-[11px] font-normal tabular-nums opacity-70">
                  {i + 1} · {intervalLabel(now, due[rating])}
                </span>
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <Button size="md" onClick={() => setRevealed(true)} className="self-start">
          Show answer <Kbd>Space</Kbd>
        </Button>
      )}
    </div>
  );
}

/**
 * Reviews the book's due cards over the reader. Space shows the answer, 1 to 4
 * rate it, Escape closes. Keys typed into a text field are left alone; the book
 * holds back its own shortcuts while the sheet is open.
 */
export function ReviewSheet({ cards, onClose, onJump }: { cards: CardsApi; onClose(): void; onJump(anchor: Anchor): void }) {
  const [now, setNow] = useState(() => new Date());
  const [done, setDone] = useState(0);
  const sheet = useRef<HTMLDivElement>(null);
  const queue = reviewQueue(cards.sets, now);
  const head = queue[0];
  const comeBack = head ? null : nextLearningAt(cards.sets, now);

  useEffect(() => sheet.current?.focus(), []);

  /* A learning step comes due while the sheet is open: wake up for it. */
  useEffect(() => {
    if (!comeBack) return;
    const timer = setTimeout(() => setNow(new Date()), Math.max(0, comeBack.getTime() - Date.now()) + 250);
    return () => clearTimeout(timer);
  }, [comeBack]);

  const onEscape = useEffectEvent(onClose);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isTextEntry(event.target)) onEscape();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const rate = (set: CardSet, cueId: string, rating: Rating) => {
    cards.change({ op: "review", setId: set.id, cueId, rating, reps: set.schedule.reps });
    setDone((n) => n + 1);
    setNow(new Date());
  };

  return (
    <div
      ref={sheet}
      tabIndex={-1}
      role="dialog"
      aria-modal
      aria-label="Review cards"
      className="animate-fade absolute inset-0 z-30 flex flex-col bg-page outline-none"
    >
      <div className="flex h-11 shrink-0 items-center gap-3 px-3">
        <span className="text-label text-fog tabular-nums">{head ? `${queue.length} left` : "Done"}</span>
        {done ? <span className="text-label text-dim tabular-nums">{done} reviewed</span> : null}
        <span className="flex-1" />
        <IconButton label="Close review (Escape)" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-6 pb-10 pt-[12vh]">
        {head ? (
          <Card
            key={`${head.id}:${head.schedule.reps}`}
            set={head}
            now={now}
            onRate={(cueId, rating) => rate(head, cueId, rating)}
            onJump={(anchor) => {
              onClose();
              onJump(anchor);
            }}
          />
        ) : (
          <div className="flex max-w-[40ch] flex-col items-center gap-3 text-center">
            <p className="text-[15px] font-medium text-paper">{done ? "That's all for now." : "Nothing to review."}</p>
            <p className="text-label leading-relaxed text-dim">
              {comeBack
                ? `A card you missed comes back in ${intervalLabel(now, comeBack)}. Keep this open or come back later.`
                : "New cards and due reviews show up here. Make cards from any passage you select."}
            </p>
            <Button onClick={onClose}>Back to the book</Button>
          </div>
        )}
      </div>
    </div>
  );
}
