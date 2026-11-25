"use client";

import { useState } from "react";
import { BookOpenText, Pencil, Play, RefreshCw, Trash2, X } from "lucide-react";
import { Button, EmptyState, IconButton, Spinner } from "@/components/ui";
import { ChapterSections } from "@/components/annotations/ChapterSections";
import { UNTITLED_SECTION } from "@/lib/shared/annotations";
import { placeLabel } from "@/lib/shared/place";
import { intervalLabel, isDue, reviewQueue } from "@/lib/shared/schedule";
import { useUnsentText } from "@/lib/client/unsent";
import type { Anchor, CardSet, Cue } from "@/lib/shared/types";
import { SIGNAL_LABELS, isMisleading, lastRecord, misconceptions, recordSignal } from "@/lib/shared/confidence";
import { SIGNAL_TONE } from "./Stance";
import type { CardsApi } from "./useCards";

const fieldClass =
  "w-full resize-none rounded-sm bg-ink/60 px-2 py-1.5 text-[13px] leading-snug text-paper outline-none ring-1 ring-line focus:ring-line-strong placeholder:text-dim";

/** Where a set stands, in a word or two. */
const status = (set: CardSet, now: Date): string => {
  if (set.schedule.state === "new") return "New";
  if (isDue(set.schedule, now)) return "Due";
  return `In ${intervalLabel(now, new Date(set.schedule.due))}`;
};

function CueEditor({ cue, onSave, onCancel }: { cue: Cue; onSave(question: string, answer: string): void; onCancel(): void }) {
  const [question, setQuestion] = useState(cue.question);
  const [answer, setAnswer] = useState(cue.answer);
  useUnsentText(question !== cue.question || answer !== cue.answer);
  const ready = question.trim() && answer.trim();
  const save = () => ready && onSave(question.trim(), answer.trim());
  return (
    <form
      className="flex flex-col gap-1.5 py-1"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) save();
      }}
    >
      <textarea aria-label="Question" autoFocus rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} className={fieldClass} />
      <textarea aria-label="Answer" rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} className={fieldClass} />
      <div className="flex justify-end gap-1">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!ready}>
          Save
        </Button>
      </div>
    </form>
  );
}

/** How the cue was last answered, when the reader said how sure they were: "Lucky guess · 30 %". */
function LastAnswer({ set, cue }: { set: CardSet; cue: Cue }) {
  const last = lastRecord(set, cue.id);
  const signal = last && recordSignal(last);
  if (!last || !signal) return null;
  return (
    <p className={`mt-0.5 text-[11px] tabular-nums ${SIGNAL_TONE[signal]}`} title={last.thinking ? `You were thinking: ${last.thinking}` : undefined}>
      {SIGNAL_LABELS[signal]} · {last.confidence} %
    </p>
  );
}

/** Card sets by chapter in reading order, with the review button and any cards still being written. */
export function CardsTab({
  cards,
  onReview,
  onJump,
  onRemake,
}: {
  cards: CardsApi;
  onReview(): void;
  onJump(anchor: Anchor): void;
  /** Asks the tutor for a better card on the set's passage; null when there is no tutor to ask. */
  onRemake: ((set: CardSet) => void) | null;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const now = new Date();
  const ready = reviewQueue(cards.sets, now).length;
  const total = cards.sets.reduce((sum, set) => sum + set.cues.length, 0);

  const progress = (
    <>
      {cards.jobs.map((job) => (
        <p key={job.id} className="flex items-center gap-2 px-3 py-1.5 text-label text-fog">
          <Spinner />
          <span className="min-w-0 truncate">Writing cards for “{job.quote}”</span>
        </p>
      ))}
      {cards.notice ? (
        <div role="status" className={`flex items-start gap-1 py-1.5 pl-3 pr-1.5 text-label ${cards.notice.kind === "error" ? "text-danger" : "text-fog"}`}>
          <p className="min-w-0 flex-1 py-px [overflow-wrap:anywhere]">{cards.notice.text}</p>
          {/* Errors stay until dismissed; the others go by themselves. */}
          {cards.notice.kind === "error" ? (
            <IconButton label="Dismiss" size="sm" onClick={cards.dismissNotice}>
              <X />
            </IconButton>
          ) : null}
        </div>
      ) : null}
    </>
  );

  if (!cards.sets.length) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {progress}
        <EmptyState icon={<BookOpenText />} title="No cards yet" body="Select a passage, then choose the card button. The tutor writes a few questions on it for you to review later." />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pb-2">
        {ready ? (
          <Button variant="primary" onClick={onReview}>
            <Play />
            Review {ready}
          </Button>
        ) : (
          <span className="text-label font-medium text-fog">Nothing to review</span>
        )}
        <span className="text-[11px] text-dim tabular-nums">
          {total} {total === 1 ? "card" : "cards"} on {cards.sets.length} {cards.sets.length === 1 ? "passage" : "passages"}
        </span>
      </div>
      {progress}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <ChapterSections items={cards.sets} listClassName="flex flex-col gap-1">
          {(set) => (
            <li key={set.id} className="group/set rounded-lg px-2 py-2 hover:bg-tint">
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => onJump(set.anchor)}
                  title="Go to this passage"
                  className="press min-w-0 flex-1 text-left"
                >
                  <span className="line-clamp-2 font-reading text-[12px] leading-relaxed text-prose/80">{set.quote}</span>
                  <span className="mt-1 flex items-center gap-1.5 text-[11px] text-dim">
                    <span className="min-w-0 truncate">{placeLabel(set.chapterTitle, set.anchor) ?? UNTITLED_SECTION}</span>
                    <span aria-hidden className="size-0.5 shrink-0 rounded-full bg-dim/60" />
                    <span className="shrink-0 tabular-nums">{status(set, now)}</span>
                  </span>
                </button>
                <IconButton
                  label="Delete these cards"
                  size="sm"
                  onClick={() => cards.change({ op: "delete-set", setId: set.id })}
                  className="opacity-0 group-hover/set:opacity-100 focus-visible:opacity-100"
                >
                  <Trash2 />
                </IconButton>
              </div>
              <ol className="mt-1.5 flex flex-col gap-1 border-l border-line pl-2.5">
                {set.cues.map((cue) =>
                  editing === cue.id ? (
                    <li key={cue.id}>
                      <CueEditor
                        cue={cue}
                        onCancel={() => setEditing(null)}
                        onSave={(question, answer) => {
                          cards.change({ op: "edit-cue", setId: set.id, cueId: cue.id, question, answer });
                          setEditing(null);
                        }}
                      />
                    </li>
                  ) : (
                    <li key={cue.id} className="group/cue relative pr-14">
                      <p className="text-[13px] leading-snug text-paper">{cue.question}</p>
                      <p className="mt-0.5 text-label leading-snug text-dim">{cue.answer}</p>
                      <LastAnswer set={set} cue={cue} />
                      {isMisleading(set, cue.id) ? (
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] leading-snug text-danger">
                          <span>Answered wrong while sure {misconceptions(set, cue.id)} times. The question may be what misleads.</span>
                          {onRemake ? (
                            <button type="button" onClick={() => onRemake(set)} className="press inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline">
                              <RefreshCw aria-hidden className="size-3" />
                              Ask for a better card
                            </button>
                          ) : null}
                        </p>
                      ) : null}
                      <div className="absolute right-0 top-0 flex gap-0.5 opacity-0 group-hover/cue:opacity-100 focus-within:opacity-100">
                        <IconButton label="Edit card" size="sm" onClick={() => setEditing(cue.id)}>
                          <Pencil />
                        </IconButton>
                        <IconButton label="Delete card" size="sm" onClick={() => cards.change({ op: "delete-cue", setId: set.id, cueId: cue.id })}>
                          <Trash2 />
                        </IconButton>
                      </div>
                    </li>
                  ),
                )}
              </ol>
            </li>
          )}
        </ChapterSections>
      </div>
    </div>
  );
}
