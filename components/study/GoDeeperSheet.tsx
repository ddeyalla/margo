"use client";

import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import { X } from "lucide-react";
import { Markdown, StreamingMarkdown } from "@/components/chat/Markdown";
import { awaitsAnswer, useStreaming, type Tutor } from "@/components/chat/useTutor";
import { Button, IconButton, Kbd, Spinner, TextArea } from "@/components/ui";
import { studyStep } from "@/lib/client/api";
import { useUnsentText } from "@/lib/client/unsent";
import { placeLabel } from "@/lib/shared/place";
import { hintsGiven, MAX_ANSWER, standing, studyState, toldAnswer, type StudyThread } from "@/lib/shared/study";
import type { Anchor, BookId, ProviderId } from "@/lib/shared/types";
import { JUST_TELL_ME } from "@/lib/shared/work";
import { Outcome, Passage } from "./Outcome";
import type { StudyView } from "./useStudy";

/** One study thread in the sheet: the question with the passage out of sight, then the grade with the passage back. */
function Turn({
  bookId,
  thread,
  tutor,
  provider,
  unavailable,
  leaveRef,
  onClose,
  onJump,
}: {
  bookId: BookId;
  thread: StudyThread;
  tutor: Tutor;
  provider: ProviderId | null;
  unavailable: string | null;
  /** Set to this turn's way out, which saves an unfinished answer first; the sheet's Escape and close button use it. */
  leaveRef: RefObject<(() => void) | null>;
  onClose(): void;
  onJump(): void;
}) {
  const { study } = thread;
  const [draft, setDraft] = useState(study.draft);
  const [grading, setGrading] = useState(false);
  /* The reader chose to answer again after a grade, or left an answer unfinished last time. */
  const [again, setAgain] = useState(study.draft.length > 0);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const streaming = useStreaming(tutor.live, thread.id);
  useUnsentText(draft.trim().length > 0 && draft !== study.draft);

  const { hintsUsed, hintsLeft, told } = studyState(thread);
  const last = study.turns.at(-1);
  const stage = told ? "told" : last && !again ? "graded" : "answering";
  const busy = tutor.sending || grading;
  const blocked = unavailable ?? (provider ? null : "Choose a tutor first");
  /* A hint or "Just tell me" the tutor never answered: stopped, or failed. */
  const unanswered = !tutor.sending && awaitsAnswer(thread);
  const failed = !tutor.sending && tutor.lastFailure?.threadId === thread.id ? tutor.lastFailure.message : null;

  const send = async (step: Parameters<typeof studyStep>[1], signal?: AbortSignal) => {
    const result = await studyStep(bookId, step, signal);
    if (!result) return false;
    if ("error" in result) {
      setError(result.error);
      return false;
    }
    setError(null);
    tutor.adopt(result.thread);
    return true;
  };

  const submit = async () => {
    const answer = draft.trim();
    if (!answer || busy || !provider || blocked) return;
    const abort = new AbortController();
    request.current = abort;
    setGrading(true);
    const graded = await send({ op: "answer", provider, threadId: thread.id, answer }, abort.signal);
    request.current = null;
    setGrading(false);
    if (graded) {
      setDraft("");
      setAgain(false);
    }
  };

  /* Leaving saves what is written; the thread keeps it for next time. */
  const leave = useEffectEvent(() => {
    request.current?.abort();
    if (draft !== study.draft) void send({ op: "draft", threadId: thread.id, draft: draft.slice(0, MAX_ANSWER) });
    onClose();
  });
  useEffect(() => {
    leaveRef.current = leave;
    return () => {
      leaveRef.current = null;
    };
  }, [leaveRef]);

  const say = (text: string | null) => {
    if (provider && !busy && !blocked) tutor.say(thread.id, text, provider);
  };
  const retryLine =
    unanswered || failed ? (
      <p role="alert" className="flex flex-wrap items-center gap-2 text-label text-dim">
        {failed ? `The tutor couldn’t answer. ${failed}` : "The tutor didn’t answer."}
        {unanswered ? (
          <Button size="sm" disabled={busy || !!blocked} onClick={() => say(null)}>
            Ask again
          </Button>
        ) : null}
      </p>
    ) : null;
  const tellMe = (
    <Button size="md" variant="ghost" disabled={busy || !!blocked} title={blocked ?? undefined} onClick={() => say(JUST_TELL_ME)}>
      Just tell me
    </Button>
  );

  if (stage === "told") {
    const answer = toldAnswer(thread);
    return (
      <div className="flex w-full max-w-[600px] flex-col gap-5">
        <div className="text-headline font-medium leading-snug text-paper">
          <Markdown text={study.question} />
        </div>
        <Passage quote={thread.quote} onJump={onJump} />
        {answer ? (
          <div className="text-callout leading-relaxed text-prose">
            <Markdown text={answer.content} />
          </div>
        ) : streaming ? (
          <div aria-live="polite" aria-busy="true" className="text-callout leading-relaxed text-prose">
            <StreamingMarkdown text={streaming} />
          </div>
        ) : tutor.sending ? (
          <p role="status" className="flex items-center gap-2 text-label text-dim">
            <Spinner />
            Thinking…
          </p>
        ) : (
          retryLine
        )}
        <Button size="md" variant="primary" onClick={onClose} className="self-start">
          Back to the book
        </Button>
      </div>
    );
  }

  if (stage === "graded" && last) {
    const right = standing(last) === "right";
    return (
      <div className="flex w-full max-w-[600px] flex-col gap-5">
        <div className="text-headline font-medium leading-snug text-paper">
          <Markdown text={study.question} />
        </div>
        <Outcome turn={last} quote={thread.quote} onOverrule={(override) => void send({ op: "overrule", threadId: thread.id, at: last.at, override })} onJump={onJump} />
        {error ? <p role="alert" className="text-label text-danger">{error}</p> : null}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="md" variant={right ? "outline" : "primary"} onClick={() => setAgain(true)}>
            Try again
          </Button>
          {tellMe}
          <Button size="md" variant={right ? "primary" : "outline"} onClick={onClose}>
            Back to the book
          </Button>
        </div>
      </div>
    );
  }

  const hints = hintsGiven(thread);
  return (
    <div className="flex w-full max-w-[600px] flex-col gap-5">
      <p className="text-label text-dim">
        {study.mode === "guess" ? "Try it before it’s explained" : "You’ve asked about this passage. Now say it back"} · the passage is hidden while you answer
      </p>
      <div className="text-headline font-medium leading-snug text-paper">
        <Markdown text={study.question} />
      </div>
      {hints.length || streaming !== null ? (
        <ol className="flex flex-col gap-2">
          {hints.map((hint, index) => (
            <li key={index} className="flex gap-2 text-callout leading-relaxed text-prose">
              <span className="shrink-0 text-label leading-relaxed text-dim tabular-nums">Hint {index + 1}</span>
              <div className="min-w-0">
                <Markdown text={hint} />
              </div>
            </li>
          ))}
          {streaming !== null ? (
            <li aria-live="polite" aria-busy="true" className="flex gap-2 text-callout leading-relaxed text-prose">
              <span className="shrink-0 text-label leading-relaxed text-dim tabular-nums">Hint {hints.length + 1}</span>
              <div className="min-w-0">{streaming ? <StreamingMarkdown text={streaming} /> : <Spinner />}</div>
            </li>
          ) : null}
        </ol>
      ) : null}
      {retryLine}
      <TextArea
        autoFocus
        rows={4}
        value={draft}
        maxLength={MAX_ANSWER}
        aria-label="Your answer"
        placeholder={study.mode === "guess" ? "Your best guess, in a sentence or two…" : "In your own words…"}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          }
        }}
        className="text-callout leading-relaxed"
      />
      {error ? <p role="alert" className="text-label text-danger">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <span title={blocked ?? undefined} className="inline-flex">
          <Button size="md" variant="primary" disabled={!draft.trim() || busy || !!blocked} onClick={() => void submit()}>
            {grading ? <Spinner /> : null}
            {grading ? "Checking…" : "Check"} {grading ? null : <Kbd>Enter</Kbd>}
          </Button>
        </span>
        <Button size="md" disabled={busy || !!blocked || unanswered || hintsLeft === 0} title={blocked ?? (hintsLeft ? `${hintsLeft} left` : "No hints left")} onClick={() => say(`Hint ${hintsUsed + 1}`)}>
          Hint
        </Button>
        {tellMe}
        <span className="flex-1" />
        <span className="text-caption text-dim">
          <Kbd>Esc</Kbd> saves and closes
        </span>
      </div>
    </div>
  );
}

/**
 * The reader's turn on a passage, over the book: answer first with the passage out of sight, then see how the answer
 * was graded against it. Opening it can wait on the tutor for a question; grading waits on the checker. The grade is
 * advice: one tap overrules it. Enter checks the answer, and Escape saves and closes from anywhere in the sheet.
 */
export function GoDeeperSheet({
  bookId,
  study,
  tutor,
  provider,
  unavailable,
  onJump,
}: {
  bookId: BookId;
  study: StudyView;
  tutor: Tutor;
  provider: ProviderId | null;
  unavailable: string | null;
  onJump(anchor: Anchor): void;
}) {
  const { thread, error, close } = study;
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!thread) sheet.current?.focus();
  }, [thread]);
  /* The open turn's way out, which saves first. Before a thread exists there is nothing to save. */
  const leaveRef = useRef<(() => void) | null>(null);
  const leave = useEffectEvent(() => (leaveRef.current ?? close)());
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      /* Escape that ends an IME composition, or closes a dialog over the sheet such as search, is not for the sheet. */
      if (event.key !== "Escape" || event.isComposing || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      leave();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const place = thread ? placeLabel(thread.chapterTitle, thread.anchor) : null;

  return (
    <div ref={sheet} tabIndex={-1} role="dialog" aria-modal aria-label="Go deeper" className="animate-fade absolute inset-0 z-30 flex flex-col bg-page outline-none">
      <div className="flex h-11 shrink-0 items-center gap-3 px-3">
        <span className="min-w-0 truncate text-label text-fog">Go deeper{place ? ` · ${place}` : ""}</span>
        <span className="flex-1" />
        <IconButton label="Save and close (Escape)" onClick={() => (leaveRef.current ?? close)()}>
          <X />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-6 pb-10 pt-[10vh]">
        {thread ? (
          <Turn
            key={thread.id}
            bookId={bookId}
            thread={thread}
            tutor={tutor}
            provider={provider}
            unavailable={unavailable}
            leaveRef={leaveRef}
            onClose={close}
            onJump={() => {
              close();
              onJump(thread.anchor);
            }}
          />
        ) : error ? (
          <div className="flex max-w-[44ch] flex-col items-center gap-3 text-center">
            <p className="text-title font-medium text-paper">Couldn’t start this one.</p>
            <p role="alert" className="text-label leading-relaxed text-danger">{error}</p>
            <div className="flex gap-2">
              {study.canRetry ? (
                <Button variant="primary" onClick={study.retry}>
                  Try again
                </Button>
              ) : null}
              <Button onClick={close}>Back to the book</Button>
            </div>
          </div>
        ) : (
          <p role="status" className="flex items-center gap-2 text-label text-dim">
            <Spinner />
            Writing a question for you to try…
          </p>
        )}
      </div>
    </div>
  );
}
