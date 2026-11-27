"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { SignalSummary, StanceInput } from "@/components/cards/Stance";
import { Markdown } from "@/components/chat/Markdown";
import type { TocEntry } from "@/components/reader/types";
import { Outcome } from "@/components/study/Outcome";
import { Button, Kbd, Spinner, TextArea } from "@/components/ui";
import { BookModal } from "@/components/ui/dialog";
import { isTextEntry } from "@/lib/client/keys";
import { cleanStance, signalOf, SKIPPED } from "@/lib/shared/confidence";
import { isPassed, passMark, type QuizAnswer, type QuizQuestion } from "@/lib/shared/quiz";
import { answerSitting, composeTest, earlierQuizzes, isRepeat, sittingDone, startSitting, type Retest, type Sitting, type TestItem } from "@/lib/shared/sitting";
import { MAX_ANSWER, standing, type LearnerTurn } from "@/lib/shared/study";
import type { Anchor, ProviderId } from "@/lib/shared/types";
import type { QuizzesApi } from "./useQuizzes";

const keepsKeys = (target: EventTarget | null) => isTextEntry(target) && !(target instanceof HTMLInputElement && target.type === "range");

/** Plain key presses anywhere in the sheet, except while typing. */
const usePlainKeys = (handle: (event: KeyboardEvent) => void) => {
  const onKey = useEffectEvent(handle);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || keepsKeys(event.target)) return;
      onKey(event);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
};

/** The stored answer and its place in the chapter, and the reader's own mark on how they did. */
function Reveal({ question, wrote, onMark, onJump }: { question: QuizQuestion; wrote: string; onMark(correct: boolean): void; onJump(anchor: Anchor): void }) {
  usePlainKeys((event) => {
    if (event.key !== "1" && event.key !== "2") return;
    event.preventDefault();
    onMark(event.key === "2");
  });
  return (
    <div className="animate-rise flex flex-col gap-4">
      {wrote ? <p className="text-label text-dim">You answered: “{wrote}”</p> : null}
      <div className="text-callout leading-relaxed text-prose">
        <Markdown text={question.answer} />
      </div>
      <button type="button" onClick={() => onJump(question.anchor)} className="press text-left" title="Go to this place in the chapter">
        <span className="line-clamp-3 border-l border-line-strong pl-3 font-reading text-label leading-relaxed text-dim">{question.quote}</span>
      </button>
      <div className="grid grid-cols-2 gap-2 pt-1">
        <Button size="md" variant="outline" onClick={() => onMark(false)} className="flex-col !h-auto gap-0.5 py-2">
          <span>I missed it</span>
          <span className="text-caption font-normal opacity-70">1</span>
        </Button>
        <Button size="md" variant="outline" onClick={() => onMark(true)} className="flex-col !h-auto gap-0.5 py-2">
          <span>I got it</span>
          <span className="text-caption font-normal opacity-70">2</span>
        </Button>
      </div>
    </div>
  );
}

/** A recall question: say how sure you are and what you'd answer, see the answer and where it is, then mark it. */
function Recall({ question, onMark, onJump }: { question: QuizQuestion; onMark(answer: QuizAnswer): void; onJump(anchor: Anchor): void }) {
  const [revealed, setRevealed] = useState(false);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [thinking, setThinking] = useState("");

  const reveal = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setRevealed(true);
  };
  usePlainKeys((event) => {
    if (revealed || (event.key !== " " && event.key !== "Enter")) return;
    event.preventDefault();
    reveal();
  });

  if (revealed) return <Reveal question={question} wrote={thinking.trim()} onMark={(correct) => onMark({ questionId: question.id, correct, ...cleanStance(confidence, thinking) })} onJump={onJump} />;
  return (
    <>
      <StanceInput confidence={confidence} thinking={thinking} onConfidence={setConfidence} onThinking={setThinking} onSubmit={reveal} placeholder="Your answer, in a line (optional)" />
      <Button size="md" onClick={reveal} className="self-start">
        Show answer <Kbd>Space</Kbd>
      </Button>
    </>
  );
}

/**
 * An explain question: the reader writes an answer and the checker grades it against the chapter's text, showing the
 * first gap and where the text says it. The grade is advice; one tap overrules it, and an unsure grade is the
 * reader's call. When it can't be graded, the reader sees the answer and marks it, as with a recall question.
 */
function Explain({
  item,
  blocked,
  grade,
  onMark,
  onJump,
}: {
  item: TestItem;
  /** No tutor can grade right now. */
  blocked: boolean;
  grade: QuizzesApi["grade"];
  onMark(answer: QuizAnswer): void;
  onJump(anchor: Anchor): void;
}) {
  const { question } = item;
  const [draft, setDraft] = useState("");
  const [grading, setGrading] = useState(false);
  const [turn, setTurn] = useState<LearnerTurn | null>(null);
  /* Set when the answer is to be marked by the reader instead: why it wasn't graded. */
  const [ungraded, setUngraded] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const check = async () => {
    const answer = draft.trim();
    if (!answer || grading) return;
    if (blocked) return setUngraded("No tutor is available to grade it, so this one is yours to mark.");
    const abort = new AbortController();
    request.current = abort;
    setGrading(true);
    const result = await grade(item.chapter, question.id, answer, abort.signal);
    if (!result) return;
    setGrading(false);
    if ("error" in result) setUngraded(`It couldn’t be graded, so this one is yours to mark. ${result.error}`);
    else setTurn(result.turn);
  };

  if (turn) {
    const settled = standing(turn) !== "unsure";
    return (
      <>
        <Outcome turn={turn} quote={question.quote} onOverrule={(override) => setTurn({ ...turn, override })} onJump={() => onJump(question.anchor)} />
        <div className="flex flex-col gap-1">
          <p className="text-caption text-dim">The answer</p>
          <div className="text-callout leading-relaxed text-prose">
            <Markdown text={question.answer} />
          </div>
        </div>
        <Button size="md" variant="primary" disabled={!settled} title={settled ? undefined : "Say which it was first"} onClick={() => onMark({ questionId: question.id, correct: standing(turn) === "right", ...SKIPPED, turn })} className="self-start">
          Next
        </Button>
      </>
    );
  }
  if (ungraded) {
    return (
      <>
        <p role="status" className="text-label text-dim">{ungraded}</p>
        <Reveal question={question} wrote={draft.trim()} onMark={(correct) => onMark({ questionId: question.id, correct, ...cleanStance(null, draft) })} onJump={onJump} />
      </>
    );
  }
  return (
    <>
      <TextArea
        autoFocus
        rows={4}
        value={draft}
        maxLength={MAX_ANSWER}
        aria-label="Your answer"
        placeholder="In your own words, a sentence or two…"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void check();
          }
        }}
        className="text-callout leading-relaxed"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="md" variant="primary" disabled={!draft.trim() || grading} onClick={() => void check()}>
          {grading ? <Spinner /> : null}
          {grading ? "Checking…" : "Check"} {grading ? null : <Kbd>Enter</Kbd>}
        </Button>
        <Button size="md" variant="ghost" disabled={grading} onClick={() => setUngraded("Not graded: this one is yours to mark.")}>
          Just show me
        </Button>
      </div>
    </>
  );
}

/** How the sitting went: the score, the 80 % mark, and each missed question with its answer and place. */
function Result({
  sitting,
  gated,
  retest,
  onRetake,
  onClose,
  onJump,
}: {
  sitting: Sitting;
  /** A Course reads the chapter, so the mark decides whether the next one opens. */
  gated: boolean;
  retest: boolean;
  onRetake(): void;
  onClose(): void;
  onJump(anchor: Anchor): void;
}) {
  const { answers } = sitting;
  const questionOf = (id: string) => sitting.queue.find((item) => item.question.id === id)?.question;
  const right = answers.filter((a) => a.correct).length;
  const need = passMark(answers.length);
  const passed = right >= need;
  const missed = answers.filter((a) => !a.correct).flatMap((a) => questionOf(a.questionId) ?? []);
  const comesBack = missed.length && !retest ? " What you missed comes back as a short retest tomorrow." : "";
  return (
    <div className="flex w-full max-w-[560px] flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="text-headline font-medium text-paper">
          {retest || !gated ? `${right} of ${answers.length} right.` : passed ? "Passed. The chapter is done." : "Not passed yet."}
        </p>
        <p className="text-label text-dim tabular-nums">
          {retest
            ? "That was the retest of what you missed."
            : gated
              ? `${right} of ${answers.length} right · ${need} to pass${passed ? "." : ". Reread what you missed and take it again whenever you like."}${comesBack}`
              : `The 80 % mark is ${need}. It’s only a mark: nothing is locked, and you can take it again whenever you like.${comesBack}`}
        </p>
      </div>
      <SignalSummary items={answers.map((a) => ({ question: questionOf(a.questionId)?.question ?? "", signal: signalOf(a.correct, a.confidence) }))} />
      {missed.length ? (
        <ul className="flex flex-col gap-3">
          {missed.map((q) => (
            <li key={q.id} className="flex flex-col gap-1.5 rounded-lg bg-tint px-3 py-2.5">
              <p className="text-body font-medium text-paper">{q.question}</p>
              <div className="text-label leading-relaxed text-prose">
                <Markdown text={q.answer} />
              </div>
              <button type="button" onClick={() => onJump(q.anchor)} className="press text-left text-label text-dim underline-offset-2 hover:text-paper hover:underline">
                Where it is in the book: “{q.quote.slice(0, 90)}{q.quote.length > 90 ? "…" : ""}”
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <Button size="md" variant={(gated && !passed) || retest ? "primary" : "outline"} onClick={onRetake}>
          <RotateCcw />
          {retest ? "Take the whole quiz" : "Retake"}
        </Button>
        <Button size="md" variant={(gated && !passed) || retest ? "outline" : "primary"} onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

/** One go at a test, from its first question to its result. The questions are fixed when it starts. */
function Taking({
  items,
  chapter,
  retestOf,
  quizzes,
  blocked,
  onRetake,
  onClose,
  onJump,
}: {
  items: TestItem[];
  chapter: string;
  /** Set when this is a retest: the test it follows. */
  retestOf: string | null;
  quizzes: QuizzesApi;
  blocked: boolean;
  onRetake(): void;
  onClose(): void;
  onJump(anchor: Anchor): void;
}) {
  const [sitting, setSitting] = useState(() => startSitting(items));
  const [saved, setSaved] = useState<"saving" | "failed" | null>(null);

  const mark = async (answer: QuizAnswer) => {
    const next = answerSitting(sitting, answer);
    setSitting(next);
    if (!sittingDone(next)) return;
    setSaved("saving");
    const kept = await quizzes.submit({ chapter, kind: retestOf ? "retest" : "test", answers: next.answers, ...(retestOf ? { retestOf } : {}) });
    setSaved(kept ? null : "failed");
  };

  if (sittingDone(sitting)) {
    return (
      <div className="flex w-full max-w-[560px] flex-col gap-3">
        {saved === "saving" ? <Spinner /> : saved === "failed" ? <p role="alert" className="text-label text-danger">This result wasn’t saved. {quizzes.error}</p> : null}
        <Result sitting={sitting} gated={quizzes.gated(chapter)} retest={!!retestOf} onRetake={onRetake} onClose={onClose} onJump={onJump} />
      </div>
    );
  }
  const item = sitting.queue[sitting.index];
  const { question } = item;
  const notes = [
    item.format === "explain" ? "Explain, in writing" : question.kind === "why" ? "Explain why" : "Recall",
    item.chapter !== chapter ? `from “${item.chapter}”` : null,
    isRepeat(sitting) ? "once more" : null,
  ].filter(Boolean);
  return (
    <div className="flex w-full max-w-[560px] flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="text-label text-dim tabular-nums">
          Question {sitting.index + 1} of {sitting.queue.length} · {notes.join(" · ")}
        </p>
        {question.verifiedAt ? null : <p className="text-caption text-dim">Written before questions were checked against the book’s text.</p>}
      </div>
      <div className="text-headline font-medium leading-snug text-paper">
        <Markdown text={question.question} />
      </div>
      {item.format === "explain" ? (
        <Explain key={sitting.index} item={item} blocked={blocked} grade={quizzes.grade} onMark={(a) => void mark(a)} onJump={onJump} />
      ) : (
        <Recall key={sitting.index} question={question} onMark={(a) => void mark(a)} onJump={onJump} />
      )}
    </div>
  );
}

/**
 * A chapter's quiz over the book: the test at the end of a chapter, which mixes in questions from earlier ones, or
 * the retest of its misses. Recall questions never wait on anything; the one explain question waits on the checker
 * and falls back to the reader's own mark. A quiz not written yet says so, with a way to have it written while the
 * reader carries on. Outside a Course nothing rides on the score.
 */
export function QuizSheet({
  quizzes,
  chapter,
  retest,
  toc,
  provider,
  unavailable,
  onClose,
  onJump,
}: {
  quizzes: QuizzesApi;
  chapter: string;
  /** The retest to take instead of the chapter's test. */
  retest: Retest | null;
  toc: TocEntry[] | null;
  provider: ProviderId | null;
  unavailable: string | null;
  onClose(): void;
  onJump(anchor: Anchor): void;
}) {
  const quiz = quizzes.quizFor(chapter);
  /* A retake after a retest is the whole test. */
  const [round, setRound] = useState(0);
  const retesting = retest && round === 0 ? retest : null;
  const writing = quizzes.writing.includes(chapter);
  const failed = quizzes.failed.find((f) => f.chapter === chapter);

  const jump = (anchor: Anchor) => {
    onClose();
    onJump(anchor);
  };

  return (
    <BookModal
      label={`Quiz: ${chapter}`}
      heading={
        <>
          <span className="min-w-0 truncate text-label text-fog">
            {retesting ? "Retest" : "Chapter quiz"} · {chapter}
          </span>
          {quizzes.gated(chapter) && isPassed(quiz) ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-label text-live">
              <Check aria-hidden className="size-3.5" />
              Passed
            </span>
          ) : null}
        </>
      }
      closeLabel="Close quiz (Escape)"
      veiled={!!quiz}
      /* A test part-way through lives only in this modal, so a stray click outside must not end it. */
      lightDismiss={false}
      typingKeepsEscape
      onClose={onClose}
    >
        {quiz ? (
          <Taking
            key={round}
            /* Read once, when this go starts: the quizzes change under it as its own result is saved. */
            items={retesting ? retesting.items : composeTest(quiz, earlierQuizzes(quizzes.quizzes, chapter, toc))}
            chapter={chapter}
            retestOf={retesting ? retesting.of : null}
            quizzes={quizzes}
            blocked={!provider || !!unavailable}
            onRetake={() => setRound((n) => n + 1)}
            onClose={onClose}
            onJump={jump}
          />
        ) : (
          <div className="flex max-w-[44ch] flex-col items-center gap-3 py-6 text-center">
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
              <Button onClick={onClose}>Close</Button>
            </div>
          </div>
        )}
    </BookModal>
  );
}
