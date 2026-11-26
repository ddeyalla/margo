"use client";

import { useState } from "react";
import { ListChecks, Lock, X } from "lucide-react";
import { IconButton, Spinner } from "@/components/ui";
import type { Retest } from "@/lib/shared/sitting";
import type { QuizzesApi } from "./useQuizzes";

const shell =
  "animate-rise absolute bottom-14 left-1/2 z-20 flex w-max max-w-[min(520px,calc(100%-24px))] -translate-x-1/2 items-center gap-2 rounded-lg bg-panel-raised py-1.5 pl-3 pr-1.5 text-label text-fog shadow-float";

const action = "press h-6 shrink-0 rounded-full px-2 text-label font-medium text-paper transition-colors duration-[var(--duration-fast)] hover:bg-tint-strong";

/**
 * A small note over the book: a chapter just finished and its quiz, yesterday's misses to try again, or a chapter a
 * Course puts after one not passed yet. None of it stops the book being read. Outside a Course the note only shows
 * once there is something to take, and closing it is remembered for that chapter.
 */
export function QuizNotice({ quizzes, onTake }: { quizzes: QuizzesApi; onTake(chapter: string, retest?: Retest): void }) {
  const [hiddenGate, setHiddenGate] = useState<string | null>(null);
  const { finished, gate, retest } = quizzes;

  if (finished) {
    const ready = !!quizzes.quizFor(finished);
    const writing = quizzes.writing.includes(finished);
    const failed = quizzes.failed.find((f) => f.chapter === finished);
    if (quizzes.gated(finished)) {
      return (
        <div role="status" className={shell}>
          <ListChecks aria-hidden className="size-3.5 shrink-0 text-dim" />
          <p className="line-clamp-2 min-w-0 leading-snug">
            Finished “{finished}”.{" "}
            {ready ? "Its quiz is ready." : writing ? "Its quiz is being written." : failed ? "Its quiz couldn’t be written." : "It has a quiz."}
          </p>
          {writing && !ready ? <Spinner /> : null}
          {ready || !writing ? (
            <button type="button" className={action} onClick={() => (ready ? onTake(finished) : void quizzes.write(finished))}>
              {ready ? "Take quiz" : failed ? "Try again" : "Write it"}
            </button>
          ) : null}
          <IconButton label="Dismiss" size="sm" onClick={quizzes.dismissFinished}>
            <X />
          </IconButton>
        </div>
      );
    }
    /* Nobody asked for this quiz, so one that couldn't be written is not announced. */
    if (ready || writing) {
      return (
        <div role="status" className={shell}>
          <ListChecks aria-hidden className="size-3.5 shrink-0 text-dim" />
          <p className="line-clamp-2 min-w-0 leading-snug">
            Finished “{finished}”. {ready ? "A short quiz on it is ready, about 5 minutes." : "A short quiz on it is being written."}
          </p>
          {ready ? (
            <button type="button" className={action} onClick={() => onTake(finished)}>
              Take it
            </button>
          ) : (
            <Spinner />
          )}
          <IconButton
            label="Skip this chapter’s quiz"
            size="sm"
            onClick={() => {
              quizzes.skip(finished);
              quizzes.dismissFinished();
            }}
          >
            <X />
          </IconButton>
        </div>
      );
    }
  }

  if (retest) {
    return (
      <div role="status" className={shell}>
        <ListChecks aria-hidden className="size-3.5 shrink-0 text-dim" />
        <p className="line-clamp-2 min-w-0 leading-snug">
          A {retest.items.length}-question retest of what you missed in “{retest.chapter}” is ready.
        </p>
        <button type="button" className={action} onClick={() => onTake(retest.chapter, retest)}>
          Retest
        </button>
        <IconButton label="Skip this retest" size="sm" onClick={() => quizzes.skip(retest.chapter, retest.of)}>
          <X />
        </IconButton>
      </div>
    );
  }

  if (gate && hiddenGate !== gate.step.chapter && gate.step.previous) {
    return (
      <div role="status" className={shell}>
        <Lock aria-hidden className="size-3.5 shrink-0 text-dim" />
        <p className="line-clamp-2 min-w-0 leading-snug">
          In {gate.course}, this comes after “{gate.step.previous.chapter}”, whose quiz isn’t passed yet.
        </p>
        <IconButton label="Dismiss" size="sm" onClick={() => setHiddenGate(gate.step.chapter)}>
          <X />
        </IconButton>
      </div>
    );
  }
  return null;
}
