"use client";

import { useState } from "react";
import { ListChecks, Lock, X } from "lucide-react";
import { IconButton, Spinner } from "@/components/ui";
import type { QuizzesApi } from "./useQuizzes";

const shell =
  "animate-rise absolute bottom-14 left-1/2 z-20 flex w-max max-w-[min(520px,calc(100%-24px))] -translate-x-1/2 items-center gap-2 rounded-lg bg-panel-raised py-1.5 pl-3 pr-1.5 text-label text-fog shadow-float";

const action = "press h-6 shrink-0 rounded-full px-2 text-label font-medium text-paper transition-colors duration-[var(--duration-fast)] hover:bg-tint-strong";

/**
 * A small note over the book about the Course: a chapter just finished and its quiz, or a chapter the Course puts
 * after one not passed yet. The order only advises; the book reads as usual.
 */
export function QuizNotice({ quizzes, onTake }: { quizzes: QuizzesApi; onTake(chapter: string): void }) {
  const [hiddenGate, setHiddenGate] = useState<string | null>(null);
  const { finished, gate } = quizzes;

  if (finished) {
    const ready = !!quizzes.quizFor(finished);
    const writing = quizzes.writing.includes(finished);
    const failed = quizzes.failed.find((f) => f.chapter === finished);
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
