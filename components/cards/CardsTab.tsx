"use client";

import { useState } from "react";
import { BookOpenText, Pencil, Play, Trash2 } from "lucide-react";
import { Button, EmptyState, IconButton, Spinner } from "@/components/ui";
import { byChapter, UNTITLED_SECTION } from "@/lib/shared/annotations";
import { placeLabel } from "@/lib/shared/place";
import { intervalLabel, isDue, reviewQueue } from "@/lib/shared/schedule";
import type { Anchor, CardSet, Cue } from "@/lib/shared/types";
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

/** Card sets by chapter in reading order, with the review button and any cards still being written. */
export function CardsTab({ cards, onReview, onJump }: { cards: CardsApi; onReview(): void; onJump(anchor: Anchor): void }) {
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
        <p role="status" className={`px-3 py-1.5 text-label ${cards.notice.kind === "error" ? "text-danger" : "text-fog"}`}>
          {cards.notice.text}
        </p>
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
        <Button variant="primary" onClick={onReview} disabled={!ready}>
          <Play />
          {ready ? `Review ${ready}` : "Nothing to review"}
        </Button>
        <span className="text-[11px] text-dim tabular-nums">
          {total} {total === 1 ? "card" : "cards"} on {cards.sets.length} {cards.sets.length === 1 ? "passage" : "passages"}
        </span>
      </div>
      {progress}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {byChapter(cards.sets).map((group, index) => (
          <section key={`${index}-${group.title}`} aria-label={group.title ?? UNTITLED_SECTION} className="pt-2">
            <h3 className="sticky top-0 z-10 truncate bg-panel px-2 py-1.5 text-label font-medium text-fog">{group.title ?? UNTITLED_SECTION}</h3>
            <ul className="flex flex-col gap-1">
              {group.items.map((set) => (
                <li key={set.id} className="group/set rounded-lg px-2 py-2 hover:bg-panel-raised/50">
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
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
