"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import { SignalSummary, StanceInput } from "@/components/cards/Stance";
import { Markdown } from "@/components/chat/Markdown";
import { Button, IconButton, Kbd, Spinner } from "@/components/ui";
import { isTextEntry } from "@/lib/client/keys";
import { cleanStance, signalOf } from "@/lib/shared/confidence";
import { isPassed, passMark, type ChapterQuiz, type QuizAnswer } from "@/lib/shared/quiz";
import type { Anchor } from "@/lib/shared/types";
import type { QuizzesApi } from "./useQuizzes";

const keepsKeys = (target: EventTarget | null) => isTextEntry(target) && !(target instanceof HTMLInputElement && target.type === "range");

/** One question: say how sure you are and what you'd answer, see the answer and where it is, then mark it. */
function Question({ quiz, index, onMark, onJump }: { quiz: ChapterQuiz; index: number; onMark(answer: QuizAnswer): void; onJump(anchor: Anchor): void }) {
  const question = quiz.questions[index];
  const [revealed, setRevealed] = useState(false);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [thinking, setThinking] = useState("");

  const reveal = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setRevealed(true);
  };
  const mark = (correct: boolean) => onMark({ questionId: question.id, correct, ...cleanStance(confidence, thinking) });

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (!revealed && (event.key === " " || event.key === "Enter")) {
      event.preventDefault();
      reveal();
    } else if (revealed && (event.key === "1" || event.key === "2")) {
      event.preventDefault();
      mark(event.key === "2");
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
      <p className="text-label text-dim tabular-nums">
        Question {index + 1} of {quiz.questions.length} · {question.kind === "why" ? "Explain why" : "Recall"}
      </p>
      <div className="text-headline font-medium leading-snug text-paper">
        <Markdown text={question.question} />
      </div>
      {revealed ? (
        <div className="animate-rise flex flex-col gap-4">
          {thinking.trim() ? <p className="text-label text-dim">You answered: “{thinking.trim()}”</p> : null}
          <div className="text-callout leading-relaxed text-prose">
            <Markdown text={question.answer} />
          </div>
          <button type="button" onClick={() => onJump(question.anchor)} className="press text-left" title="Go to this place in the chapter">
            <span className="line-clamp-3 border-l border-line-strong pl-3 font-reading text-label leading-relaxed text-dim">{question.quote}</span>
          </button>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button size="md" variant="outline" onClick={() => mark(false)} className="flex-col !h-auto gap-0.5 py-2">
              <span>I missed it</span>
              <span className="text-caption font-normal opacity-70">1</span>
            </Button>
            <Button size="md" variant="outline" onClick={() => mark(true)} className="flex-col !h-auto gap-0.5 py-2">
              <span>I got it</span>
              <span className="text-caption font-normal opacity-70">2</span>
            </Button>
          </div>
        </div>
      ) : (
        <>
          <StanceInput
            confidence={confidence}
            thinking={thinking}
            onConfidence={setConfidence}
            onThinking={setThinking}
            onSubmit={reveal}
            placeholder="Your answer, in a line (optional)"
          />
          <Button size="md" onClick={reveal} className="self-start">
            Show answer <Kbd>Space</Kbd>
          </Button>
        </>
      )}
    </div>
  );
}

/** How the attempt went: the score, whether it passed, and each missed question with its answer and place. */
function Result({ quiz, answers, onRetake, onClose, onJump }: { quiz: ChapterQuiz; answers: QuizAnswer[]; onRetake(): void; onClose(): void; onJump(anchor: Anchor): void }) {
  const right = answers.filter((a) => a.correct).length;
  const need = passMark(quiz.questions.length);
  const passed = right >= need;
  const missed = quiz.questions.filter((q) => answers.some((a) => a.questionId === q.id && !a.correct));
  return (
    <div className="flex w-full max-w-[560px] flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="text-headline font-medium text-paper">{passed ? "Passed. The chapter is done." : "Not passed yet."}</p>
        <p className="text-label text-dim tabular-nums">
          {right} of {quiz.questions.length} right · {need} to pass
          {passed ? "" : ". Reread what you missed and take it again whenever you like."}
        </p>
      </div>
      <SignalSummary items={answers.map((a) => ({ question: quiz.questions.find((q) => q.id === a.questionId)?.question ?? "", signal: signalOf(a.correct, a.confidence) }))} />
      {missed.length ? (
        <ul className="flex flex-col gap-3">
          {missed.map((q) => (
            <li key={q.id} className="flex flex-col gap-1.5 rounded-lg bg-tint px-3 py-2.5">
              <p className="text-body font-medium text-paper">{q.question}</p>
              <div className="text-label leading-relaxed text-prose">
                <Markdown text={q.answer} />
              </div>
              <button type="button" onClick={() => onJump(q.anchor)} className="press text-left text-label text-dim underline-offset-2 hover:text-paper hover:underline">
                Where it is in the chapter: “{q.quote.slice(0, 90)}{q.quote.length > 90 ? "…" : ""}”
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <Button size="md" variant={passed ? "outline" : "primary"} onClick={onRetake}>
          <RotateCcw />
          Retake
        </Button>
        <Button size="md" variant={passed ? "primary" : "outline"} onClick={onClose}>
          Back to the book
        </Button>
      </div>
    </div>
  );
}

/**
 * A chapter's quiz over the book. Taking it never waits on the tutor: a quiz not written yet says so, with a way
 * to have it written while the reader carries on. Answers are self-graded, as card reviews are.
 */
export function QuizSheet({ quizzes, chapter, onClose, onJump }: { quizzes: QuizzesApi; chapter: string; onClose(): void; onJump(anchor: Anchor): void }) {
  const quiz = quizzes.quizFor(chapter);
  const [answers, setAnswers] = useState<QuizAnswer[]>([]);
  const [round, setRound] = useState(0);
  const [saved, setSaved] = useState<"saving" | "saved" | "failed" | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const writing = quizzes.writing.includes(chapter);
  const failed = quizzes.failed.find((f) => f.chapter === chapter);
  const done = !!quiz && answers.length === quiz.questions.length;

  useEffect(() => sheet.current?.focus(), []);
  const onEscape = useEffectEvent(onClose);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isTextEntry(event.target)) onEscape();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const mark = async (answer: QuizAnswer) => {
    const next = [...answers, answer];
    setAnswers(next);
    if (quiz && next.length === quiz.questions.length) {
      setSaved("saving");
      setSaved((await quizzes.submit(chapter, next)) ? "saved" : "failed");
    }
  };
  const jump = (anchor: Anchor) => {
    onClose();
    onJump(anchor);
  };

  return (
    <div ref={sheet} tabIndex={-1} role="dialog" aria-modal aria-label={`Quiz: ${chapter}`} className="animate-fade absolute inset-0 z-30 flex flex-col bg-page outline-none">
      <div className="flex h-11 shrink-0 items-center gap-3 px-3">
        <span className="min-w-0 truncate text-label text-fog">Chapter quiz · {chapter}</span>
        {isPassed(quiz) ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-label text-live">
            <Check aria-hidden className="size-3.5" />
            Passed
          </span>
        ) : null}
        {saved === "saving" ? <Spinner /> : saved === "failed" ? <span className="text-label text-danger">Not saved</span> : null}
        <span className="flex-1" />
        <IconButton label="Close quiz (Escape)" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-6 pb-10 pt-[10vh]">
        {quiz ? (
          done ? (
            <Result
              quiz={quiz}
              answers={answers}
              onRetake={() => {
                setAnswers([]);
                setSaved(null);
                setRound((n) => n + 1);
              }}
              onClose={onClose}
              onJump={jump}
            />
          ) : (
            <Question key={`${round}:${answers.length}`} quiz={quiz} index={answers.length} onMark={(a) => void mark(a)} onJump={jump} />
          )
        ) : (
          <div className="flex max-w-[44ch] flex-col items-center gap-3 text-center">
            <p className="text-title font-medium text-paper">{writing ? "The quiz is being written." : "This chapter’s quiz isn’t written yet."}</p>
            <p className="text-label leading-relaxed text-dim">
              {writing
                ? "Keep reading; it shows up here when it’s ready, usually within a minute."
                : "It’s written once you finish the chapter, from the chapter’s own text. You can have it written now."}
            </p>
            {failed && !writing ? <p className="text-label text-danger">{failed.error}</p> : null}
            {quizzes.error ? <p className="text-label text-danger">{quizzes.error}</p> : null}
            <div className="flex gap-2">
              {!writing ? (
                <Button variant="primary" onClick={() => void quizzes.write(chapter)}>
                  {failed ? "Try again" : "Write it now"}
                </Button>
              ) : (
                <Spinner />
              )}
              <Button onClick={onClose}>Back to the book</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
