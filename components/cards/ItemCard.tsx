"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { Markdown } from "@/components/chat/Markdown";
import { Button, Kbd, Spinner, TextArea } from "@/components/ui";
import { isTextEntry } from "@/lib/client/keys";
import { cleanStance } from "@/lib/shared/confidence";
import { typeOf } from "@/lib/shared/items";
import { intervalLabel, pickCue, previewDue } from "@/lib/shared/schedule";
import { MAX_ANSWER } from "@/lib/shared/study";
import { RATINGS, type Anchor, type BookId, type CardSet, type Cue, type ProviderId, type Rating, type Stance } from "@/lib/shared/types";
import { StanceInput } from "./Stance";

const LABELS: Record<Rating, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };

/* A fixed draw per showing, so the item doesn't change on re-render but a set seen again can show another. */
const draw = (key: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return (hash >>> 0) / 2 ** 32;
};

/** The options in an order that stays put for this showing, so the right one isn't always where the author left it. */
const shuffled = (choices: readonly string[], seed: string): string[] => [...choices].sort((a, b) => draw(`${seed}:${a}`) - draw(`${seed}:${b}`));

/* The rail takes arrow keys, not Space or digits, so the sheet's keys still work while it has focus. */
const keepsKeys = (target: EventTarget | null) => isTextEntry(target) && !(target instanceof HTMLInputElement && target.type === "range");

/** What the grader said of a written answer, as the cards route returns it. */
interface Marked {
  verdict: "right" | "partly" | "wrong";
  unsure: boolean;
  gap: { point: string; span: string; note: string } | null;
  suggested: Rating | null;
}

type Grading = { state: "idle" } | { state: "grading" } | { state: "failed"; message: string } | { state: "graded"; marked: Marked };

const VERDICT_WORDS: Record<Marked["verdict"], string> = { right: "Right", partly: "Partly right", wrong: "Not right" };

const gradeAnswer = async (bookId: BookId, provider: ProviderId, set: CardSet, cue: Cue, answer: string): Promise<Marked> => {
  const response = await fetch(`/api/books/${bookId}/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op: "grade", provider, setId: set.id, cueId: cue.id, answer }),
  });
  const body = (await response.json().catch(() => null)) as { grade?: Marked; error?: string } | null;
  if (!response.ok || !body?.grade) throw new Error(body?.error ?? `Grading failed with ${response.status}.`);
  return body.grade;
};

/**
 * One item of the review: its prompt, answered the way its type asks. A flip is thought of, shown and rated; a
 * choice is picked, and the pick suggests the rating; a free item is written and graded, and the grade suggests
 * it. The rating is always the reader's own, and what they were helped by (options, an unsure grade) goes with it.
 */
export function ItemCard({
  bookId,
  set,
  now,
  provider,
  onRate,
  onJump,
}: {
  bookId: BookId;
  set: CardSet;
  now: Date;
  /** The tutor that grades written answers; none means a free item is flipped like any other. */
  provider: ProviderId | null;
  onRate(cueId: string, rating: Rating, stance: Stance, aided: boolean): void;
  onJump(anchor: Anchor): void;
}) {
  const cue = pickCue(set, draw(`${set.id}:${set.schedule.reps}:${set.schedule.lastReview ?? ""}`));
  const type = typeOf(cue) === "free" && !provider ? "flip" : typeOf(cue);
  const [revealed, setRevealed] = useState(false);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [thinking, setThinking] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [written, setWritten] = useState("");
  const [grading, setGrading] = useState<Grading>({ state: "idle" });
  const due = previewDue(set.schedule, now);
  const options = useMemo(() => shuffled(cue.choices ?? [], `${cue.id}:${set.schedule.reps}`), [cue.choices, cue.id, set.schedule.reps]);

  const marked = grading.state === "graded" ? grading.marked : null;
  /* What the answer suggests the rating is. The reader still presses it. */
  const suggested: Rating | null = type === "choice" && picked !== null ? (picked === cue.answer ? "good" : "again") : (marked?.suggested ?? null);
  const aided = type === "choice" || !!marked?.unsure;

  const reveal = () => {
    /* The rating keys go to the sheet, not to the thinking line. */
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setRevealed(true);
  };
  const rate = (rating: Rating) => onRate(cue.id, rating, cleanStance(confidence, thinking), aided);

  const pick = (option: string) => {
    setPicked(option);
    reveal();
  };

  const check = async () => {
    if (!provider || !written.trim() || grading.state === "grading") return;
    setGrading({ state: "grading" });
    try {
      setGrading({ state: "graded", marked: await gradeAnswer(bookId, provider, set, cue, written.trim()) });
      reveal();
    } catch (error) {
      setGrading({ state: "failed", message: error instanceof Error ? error.message : "The answer couldn't be graded." });
    }
  };

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (!revealed) {
      if (type === "flip" && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
        reveal();
      } else if (type === "choice") {
        const option = options[Number(event.key) - 1];
        if (option) {
          event.preventDefault();
          pick(option);
        }
      }
      return;
    }
    const rating = RATINGS[Number(event.key) - 1];
    if (rating) {
      event.preventDefault();
      rate(rating);
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || keepsKeys(event.target)) return;
      onKey(event);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-5">
      <div className="text-headline font-medium leading-snug text-paper">
        <Markdown text={cue.question} />
      </div>
      {revealed ? (
        <div className="animate-rise flex flex-col gap-4">
          {type === "choice" && picked !== null ? (
            <p className={`text-label font-medium ${picked === cue.answer ? "text-live" : "text-danger"}`}>{picked === cue.answer ? "That's right." : `You picked “${picked}”.`}</p>
          ) : null}
          {marked ? (
            <div className="flex flex-col gap-1 text-label leading-relaxed">
              <p className="font-medium text-fog">{marked.unsure ? "The grader isn't sure. You decide." : VERDICT_WORDS[marked.verdict]}</p>
              {marked.gap ? <p className="text-dim">{marked.gap.note}</p> : null}
            </div>
          ) : null}
          <div className="text-callout leading-relaxed text-prose">
            <Markdown text={cue.answer} />
          </div>
          {confidence !== null || thinking.trim() ? (
            <p className="text-label text-dim">
              {confidence !== null ? `You were ${confidence} % sure.` : "You skipped how sure you were."}
              {thinking.trim() ? ` You were thinking: “${thinking.trim()}”` : null}
            </p>
          ) : null}
          <button type="button" onClick={() => onJump(set.anchor)} className="press text-left" title="Go to this passage">
            <span className="line-clamp-3 border-l border-line-strong pl-3 font-reading text-label leading-relaxed text-dim">{set.quote}</span>
          </button>
          <div className="grid grid-cols-4 gap-2 pt-1">
            {RATINGS.map((rating, i) => (
              <Button
                key={rating}
                size="md"
                variant={(suggested ?? "good") === rating ? "primary" : "outline"}
                onClick={() => rate(rating)}
                className="flex-col !h-auto gap-0.5 py-2"
              >
                <span>{LABELS[rating]}</span>
                <span className="text-caption font-normal tabular-nums opacity-70">
                  {i + 1} · {intervalLabel(now, due[rating])}
                </span>
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <StanceInput confidence={confidence} thinking={thinking} onConfidence={setConfidence} onThinking={setThinking} onSubmit={type === "flip" ? reveal : () => undefined} />
          {type === "choice" ? (
            <ol className="flex flex-col gap-2">
              {options.map((option, i) => (
                <li key={option}>
                  <Button size="md" variant="outline" onClick={() => pick(option)} className="!h-auto w-full justify-start gap-2 py-2 text-left">
                    <span className="text-caption tabular-nums opacity-70">{i + 1}</span>
                    <span className="min-w-0 whitespace-normal">{option}</span>
                  </Button>
                </li>
              ))}
            </ol>
          ) : type === "free" ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void check();
              }}
            >
              <TextArea
                aria-label="Your answer"
                rows={4}
                maxLength={MAX_ANSWER}
                value={written}
                onChange={(event) => setWritten(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void check();
                }}
                placeholder="Answer in your own words"
                className="w-full"
              />
              {grading.state === "failed" ? <p className="text-label text-danger">{grading.message}</p> : null}
              <div className="flex items-center gap-3">
                <Button type="submit" size="md" disabled={!written.trim() || grading.state === "grading"}>
                  {grading.state === "grading" ? <Spinner /> : null}
                  Check answer
                </Button>
                <button type="button" onClick={reveal} className="press text-label text-dim underline-offset-2 hover:text-paper hover:underline">
                  Show answer without checking
                </button>
              </div>
            </form>
          ) : (
            <Button size="md" onClick={reveal} className="self-start">
              Show answer <Kbd>Space</Kbd>
            </Button>
          )}
        </>
      )}
    </div>
  );
}
