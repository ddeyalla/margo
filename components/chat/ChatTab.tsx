"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, CircleAlert, CornerDownRight, ImageIcon, Layers, MessageSquareText, Send, Trash2, X } from "lucide-react";
import clsx from "clsx";
import { Button, EmptyState, IconButton, Spinner } from "@/components/ui";
import { JUST_TELL_ME, MAX_HINTS, workState } from "@/lib/shared/work";
import { placeLabel } from "@/lib/shared/place";
import { threadLabel } from "@/lib/shared/threads";
import type { ParkedThread } from "@/lib/shared/parked";
import { firstQuoteNumber, threadQuotes } from "@/lib/shared/quotes";
import { isStudy, offersYourTurn, splitYourTurn, studyState } from "@/lib/shared/study";
import { dismissYourTurn, takeYourTurn, useYourTurnShown } from "@/lib/client/your-turn";
import type { Anchor, BookId, GeneralThread, ImageAttachment, PassageThread, QuotedPassage, Thread } from "@/lib/shared/types";
import { Composer } from "./Composer";
import { UsageRow } from "./UsageRow";
import { DropArea, Lightbox, MessageImages } from "./Images";
import type { PassagePlace } from "@/components/annotations/useAnnotations";
import { diagramMarkdown } from "@/lib/shared/diagrams";
import { SaveDiagram } from "./Diagram";
import { Markdown, StreamingMarkdown } from "./Markdown";
import { AnswerBoard } from "./BoardChanges";
import { SentBoard } from "./BoardChip";
import { answerChanges } from "@/components/board/link";
import { AnswerSources, CitationsContext, MessageQuotes, type Citations, type QuoteDraft } from "./Quotes";
import { useImageDraft } from "./useImageDraft";
import { awaitsAnswer, useCompacting, useStreaming, type FailedTurn, type LiveAnswer, type MessageDraft, type QueuedMessage, type Tutor } from "./useTutor";

const when = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** A pixel slack so a reader who is "at the bottom" keeps following a streaming answer. */
const PIN_SLACK = 40;

/** How many of the list's first rows arrive one after another; the rest are at or past the fold. */
const STAGGERED_ROWS = 6;

/* The book visits whose chat tab has been shown, by the visit's tutor. The list staggers in on the first
   showing only, so filtering, re-renders and coming back from a thread leave it still. */
const shownVisits = new WeakSet<object>();

/** Props for row `index` of a list that may be staggering in; `last` is the final row that takes part. */
const staggerRow = (stagger: boolean, index: number, last: number, onEnd: () => void) =>
  stagger && index <= last
    ? {
        className: "animate-stagger",
        style: { "--stagger-index": index } as CSSProperties,
        onAnimationEnd: index === last ? onEnd : undefined,
      }
    : null;

type StaggerRow = ReturnType<typeof staggerRow>;

export function ChatTab({
  shown,
  keyed,
  tutor,
  unavailable,
  onJump,
  onAsk,
  onSendParked,
  onReply,
  onRetry,
  onDeeper,
  onSaveNote,
  quotes,
  onFindQuote,
}: {
  /** The tab is on screen: selected, in an open panel. */
  shown: boolean;
  /** The reader last changed tabs with the keyboard. */
  keyed: boolean;
  tutor: Tutor;
  /** Why the tutor can't take a message, or null. */
  unavailable: string | null;
  onJump(anchor: Anchor): void;
  /** Starts a thread with no passage. */
  onAsk(draft: MessageDraft): void;
  /** Sends a parked question to the tutor. */
  onSendParked(id: string): void;
  onReply(draft: MessageDraft): void;
  onRetry(): void;
  /** Opens the reader's turn over the book: a Go deeper thread where it was left, or the "Your turn" an answer closed with. */
  onDeeper(thread: PassageThread): void;
  /** Adds a note on a passage. */
  onSaveNote(passage: PassagePlace, body: string): void;
  /** Passages quoted into the composer, waiting to be sent. */
  quotes: QuoteDraft;
  /** Goes to a quoted passage; resolves false when the book no longer has it there. */
  onFindQuote(quote: QuotedPassage): Promise<boolean>;
}) {
  const { active, failure } = tutor;
  /* Decided in the render that first shows the tab, so the rows never paint in place before they rise. The tab
     mounts when it is selected, so the list staggers when the book opens on it or the reader clicks over to it. A
     keyboard switch, or opening a collapsed panel that already holds it, is meant to be instant and shows it still. */
  const [entrance, setEntrance] = useState<"waiting" | "playing" | "done">(() =>
    !shown ? "waiting" : !keyed && !active && !shownVisits.has(tutor.live) ? "playing" : "done",
  );
  if (entrance === "waiting" && shown) setEntrance("done");
  /* Opening a thread ends the entrance, so coming back to the list is still. */
  if (entrance === "playing" && active) setEntrance("done");
  useEffect(() => {
    if (entrance !== "waiting") shownVisits.add(tutor.live);
  }, [entrance, tutor.live]);
  if (active) {
    /* A diagram in a thread about a passage can be saved as a note on that passage. */
    const saveDiagram =
      active.kind === "passage"
        ? (source: string) => onSaveNote({ anchor: active.anchor, text: active.quote, chapterTitle: active.chapterTitle }, diagramMarkdown(source))
        : null;
    /* Citations in any thread lead to the passages quoted into it, and can be kept as notes on them. */
    const citations: Citations = {
      quotes: threadQuotes(active.messages),
      find: onFindQuote,
      save: (quote, body) => onSaveNote({ anchor: quote.anchor, text: quote.text, chapterTitle: quote.chapterTitle }, body),
    };
    return (
      <CitationsContext value={citations}>
        <SaveDiagram value={saveDiagram}>
          <ThreadView
            key={active.id}
            bookId={tutor.bookId}
            thread={active}
            live={tutor.live}
            sending={tutor.sending}
            failure={failure}
            queued={tutor.queued}
            onSendQueued={tutor.sendQueued}
            onCancelQueued={tutor.cancelQueued}
            unavailable={unavailable}
            onBack={() => tutor.open(null)}
            onJump={() => active.anchor && onJump(active.anchor)}
            onReply={onReply}
            onRetry={onRetry}
            onDeeper={onDeeper}
            onStop={tutor.stop}
            quotes={quotes}
          />
        </SaveDiagram>
      </CitationsContext>
    );
  }
  return (
    <Threads
      tutor={tutor}
      stagger={entrance === "playing"}
      onStaggerEnd={() => setEntrance("done")}
      unavailable={unavailable}
      onJump={onJump}
      onAsk={onAsk}
      onSendParked={onSendParked}
      onRetry={onRetry}
      quotes={quotes}
    />
  );
}

/** The book's threads, and a composer for a question with no passage. */
function Threads({
  tutor,
  stagger,
  onStaggerEnd,
  unavailable,
  onJump,
  onAsk,
  onSendParked,
  onRetry,
  quotes,
}: {
  tutor: Tutor;
  /** The rows are making their first entrance. */
  stagger: boolean;
  onStaggerEnd(): void;
  unavailable: string | null;
  onJump(anchor: Anchor): void;
  onAsk(draft: MessageDraft): void;
  onSendParked(id: string): void;
  onRetry(): void;
  quotes: QuoteDraft;
}) {
  const { failure } = tutor;
  const images = useImageDraft(tutor.bookId);
  return (
    <DropArea onFiles={images.add} enabled={!unavailable} className="flex min-h-0 flex-1 flex-col">
      {failure ? <FailureNote failure={failure} onRetry={failure.request ? onRetry : null} className="mx-3 mt-1" /> : null}
      {tutor.threads.length || tutor.parked.length ? (
        <ThreadList
          threads={tutor.threads}
          parked={tutor.parked}
          stagger={stagger}
          onStaggerEnd={onStaggerEnd}
          unavailable={unavailable}
          sending={tutor.sending}
          onJump={onJump}
          onSend={onSendParked}
          onDiscard={tutor.discard}
          onOpen={(thread) => {
            tutor.open(thread.id);
            /* A question with no passage keeps the reader where they are; its header leads back to where it was asked. */
            if (thread.kind === "passage") onJump(thread.anchor);
          }}
        />
      ) : (
        <EmptyState
          icon={<MessageSquareText />}
          title="Ask about a passage"
          body="Select text in the book, then choose Ask or Go deeper. Or ask below, and paste or drop an image to show the tutor."
        />
      )}
      {tutor.queued ? (
        <QueuedNote
          queued={tutor.queued}
          elsewhere={tutor.queued.kind === "reply"}
          sending={tutor.sending}
          onSend={tutor.sendQueued}
          onCancel={tutor.cancelQueued}
        />
      ) : null}
      <Composer
        placeholder="Ask about the book, or paste an image…"
        disabledReason={unavailable}
        sending={tutor.sending}
        waiting={tutor.queued !== null}
        images={images}
        quotes={quotes}
        onSend={onAsk}
        onStop={tutor.stop}
      />
    </DropArea>
  );
}

/** Questions saved on a passage, waiting to be sent. Nothing here has been asked. */
function ParkedList({
  parked,
  row,
  unavailable,
  sending,
  onJump,
  onSend,
  onDiscard,
}: {
  parked: ParkedThread[];
  row(index: number): StaggerRow;
  unavailable: string | null;
  sending: boolean;
  onJump(anchor: Anchor): void;
  onSend(id: string): void;
  onDiscard(id: string): void;
}) {
  return (
    <section aria-label="Parked questions" className="mb-2">
      <p className="px-2 pb-1.5 pt-1 text-caption text-dim">Parked · {parked.length}</p>
      <ul className="flex flex-col gap-0.5">
        {parked.map((thread, index) => {
          const place = placeLabel(thread.chapterTitle, thread.anchor);
          const motion = row(index);
          return (
            <li key={thread.id} {...motion} className={clsx("flex flex-col gap-1.5 rounded-lg px-2.5 py-2 hover:bg-tint", motion?.className)}>
              <button
                type="button"
                onClick={() => onJump(thread.anchor)}
                title={place ? `Go to this passage · ${place}` : "Go to this passage"}
                className="press line-clamp-2 rounded-xs text-left font-reading text-body leading-snug text-dim transition-colors duration-[var(--duration-fast)] hover:text-fog"
              >
                {thread.quote}
              </button>
              <p className="whitespace-pre-wrap break-words text-body leading-snug text-paper">{thread.messages[0]?.content}</p>
              <div className="flex items-center gap-1">
                <Button size="sm" disabled={!!unavailable || sending} title={unavailable ?? "Send this question to the tutor"} onClick={() => onSend(thread.id)}>
                  <Send />
                  Ask now
                </Button>
                <span className="min-w-0 flex-1 truncate px-1 text-caption text-dim">{place}</span>
                <IconButton label="Delete this parked question" size="sm" onClick={() => onDiscard(thread.id)}>
                  <Trash2 />
                </IconButton>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ThreadList({
  threads,
  parked,
  stagger,
  onStaggerEnd,
  unavailable,
  sending,
  onJump,
  onSend,
  onDiscard,
  onOpen,
}: {
  threads: Thread[];
  parked: ParkedThread[];
  stagger: boolean;
  onStaggerEnd(): void;
  unavailable: string | null;
  sending: boolean;
  onJump(anchor: Anchor): void;
  onSend(id: string): void;
  onDiscard(id: string): void;
  onOpen(thread: Thread): void;
}) {
  /* Parked questions sit first on screen, so they lead the entrance; a short list ends on its own last row. */
  const last = Math.min(parked.length + threads.length, STAGGERED_ROWS) - 1;
  const row = (index: number) => staggerRow(stagger, index, last, onStaggerEnd);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      {parked.length ? <ParkedList parked={parked} row={row} unavailable={unavailable} sending={sending} onJump={onJump} onSend={onSend} onDiscard={onDiscard} /> : null}
      {threads.length ? (
        <p className="px-2 pb-1.5 pt-1 text-caption text-dim">
          {threads.length} {threads.length === 1 ? "thread" : "threads"} in this book
        </p>
      ) : null}
      <ul className="flex flex-col gap-0.5">
        {threads.map((thread, index) => {
          const first = thread.messages[0]?.content ?? "";
          const label = threadLabel(thread);
          const place = thread.anchor && placeLabel(thread.chapterTitle, thread.anchor);
          return (
            <li key={thread.id} {...row(parked.length + index)}>
              <button
                type="button"
                onClick={() => onOpen(thread)}
                title={place ?? undefined}
                className="press flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors duration-[var(--duration-fast)] hover:bg-tint focus-visible:bg-tint"
              >
                {thread.kind === "passage" ? (
                  <span className="line-clamp-2 font-reading text-body leading-snug text-prose">{thread.quote}</span>
                ) : (
                  <span className="line-clamp-2 text-body leading-snug text-paper">
                    {thread.messages[0]?.attachments?.length ? (
                      <ImageIcon className="mr-1.5 inline size-3.5 align-[-2px] text-dim" aria-label="With an image" />
                    ) : null}
                    {first}
                  </span>
                )}
                <span className="flex min-w-0 items-center gap-2 text-caption text-dim">
                  <span className="min-w-0 flex-1 truncate">
                    {label}
                    {place ? ` · ${place}` : ""}
                  </span>
                  <span className="shrink-0 tabular-nums">{when.format(new Date(thread.createdAt))}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ThreadView({
  bookId,
  thread,
  live,
  sending,
  failure,
  queued,
  onSendQueued,
  onCancelQueued,
  unavailable,
  onBack,
  onJump,
  onReply,
  onRetry,
  onDeeper,
  onStop,
  quotes,
}: {
  bookId: BookId;
  thread: Thread;
  live: LiveAnswer;
  /** Any request is in flight, for this thread or another. */
  sending: boolean;
  failure: FailedTurn | null;
  /** The message waiting for the answer in flight, for this thread or another. */
  queued: QueuedMessage | null;
  onSendQueued(): void;
  onCancelQueued(): void;
  unavailable: string | null;
  onBack(): void;
  onJump(): void;
  onReply(draft: MessageDraft): void;
  onRetry(): void;
  onDeeper(thread: PassageThread): void;
  onStop(): void;
  quotes: QuoteDraft;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const images = useImageDraft(bookId);
  const [viewing, setViewing] = useState<ImageAttachment | null>(null);
  /* Messages from this index on were sent while the thread was open, and rise in; the history it opened with
     stays still. A thread the reader has just started opens on its first question, which counts as sent. */
  const [firstSent] = useState(() =>
    awaitsAnswer(thread) && live.get()?.threadId === thread.id ? thread.messages.length - 1 : thread.messages.length,
  );

  const follow = useCallback(() => {
    const scroller = scrollRef.current;
    if (scroller && pinned.current) scroller.scrollTop = scroller.scrollHeight;
  }, []);
  useLayoutEffect(() => follow(), [follow, thread.messages.length, failure]);

  /* The reader's last message went unanswered: stopped before the first word, or failed. */
  const unanswered = !sending && awaitsAnswer(thread);
  const { leading, hintsUsed } = workState(thread);
  const busy = sending || !!unavailable || queued !== null;
  /* An Ask answer may close with a "Your turn" line. It is never shown as text: the last answer's becomes a prompt. */
  const asked = offersYourTurn(thread) ? thread : null;
  const shown = (content: string) => (asked ? splitYourTurn(content).body : content);
  const lastMessage = thread.messages.at(-1);
  const yourTurn = asked && lastMessage?.role === "assistant" && !lastMessage.partial ? splitYourTurn(lastMessage.content).prompt : null;
  /* A Go deeper thread the reader hasn't been told the answer to carries on in its sheet. */
  const study = isStudy(thread) && !studyState(thread).told ? thread : null;

  return (
    <DropArea onFiles={images.add} enabled={!unavailable} className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center px-2">
        <button
          type="button"
          onClick={onBack}
          className="press inline-flex h-7 items-center gap-1 rounded-sm pl-1 pr-2 text-label text-dim transition-colors duration-[var(--duration-fast)] hover:bg-tint hover:text-paper"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          Threads
        </button>
      </div>
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_SLACK;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-4"
      >
        {thread.kind === "passage" ? (
          <button
            type="button"
            onClick={onJump}
            title="Go to this passage"
            className="group block w-full rounded-lg bg-panel-raised p-3 text-left shadow-chip transition-colors duration-[var(--duration-fast)] hover:bg-panel-hover"
          >
            <span className="line-clamp-6 whitespace-pre-line font-reading text-callout leading-relaxed text-prose">{thread.quote}</span>
            <span className="mt-2 flex min-w-0 items-center gap-1.5 text-caption text-dim group-hover:text-fog">
              <CornerDownRight className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{placeLabel(thread.chapterTitle, thread.anchor) ?? "Go to passage"}</span>
            </span>
          </button>
        ) : (
          <AskedAt thread={thread} onJump={onJump} />
        )}

        <div className="mt-4 flex flex-col gap-4">
          {thread.messages.flatMap((message, index) => [
            index === thread.compaction?.keepFrom ? (
              <p key="summarized" className="flex items-center gap-3 text-caption text-dim">
                <span aria-hidden className="h-px flex-1 bg-line-strong" />
                The tutor reads the turns above as a summary
                <span aria-hidden className="h-px flex-1 bg-line-strong" />
              </p>
            ) : null,
            message.role === "user" ? (
              <div key={index} className={clsx("flex flex-col items-end gap-1.5 pl-8", index >= firstSent && "animate-rise")}>
                {message.quotes?.length ? <MessageQuotes quotes={message.quotes} first={firstQuoteNumber(thread.messages, index)} /> : null}
                {message.attachments?.length ? <MessageImages bookId={bookId} images={message.attachments} onOpen={setViewing} /> : null}
                {message.board ? <SentBoard title={message.board.title} /> : null}
                <p className="min-w-0 whitespace-pre-wrap break-words rounded-lg rounded-br-xs bg-panel-raised px-3.5 shadow-chip py-2.5 text-body text-paper">
                  {message.content}
                </p>
              </div>
            ) : (
              <div key={index}>
                <AnswerBoard value={answerChanges(thread.id, thread.messages, index)}>
                  <Markdown text={shown(message.content)} />
                </AnswerBoard>
                <AnswerSources text={message.content} />
                {message.partial ? <p className="mt-1.5 text-caption text-dim">Stopped before the answer finished.</p> : null}
              </div>
            ),
          ])}
          {asked && yourTurn && !sending ? <YourTurn threadId={asked.id} prompt={yourTurn} disabled={!!unavailable} onTake={() => onDeeper(asked)} /> : null}
          <StreamingAnswer live={live} threadId={thread.id} trim={!!asked} onGrow={follow} />
          {failure ? (
            <FailureNote failure={failure} onRetry={unanswered ? onRetry : null} />
          ) : unanswered ? (
            <p className="flex items-center gap-2 text-caption text-dim">
              Stopped before the tutor answered.
              <button
                type="button"
                onClick={onRetry}
                className="press rounded-xs px-1 text-fog underline decoration-dim underline-offset-2 transition-colors duration-[var(--duration-fast)] hover:text-paper"
              >
                Ask again
              </button>
            </p>
          ) : null}
        </div>
      </div>
      {leading ? (
        <div className="flex shrink-0 items-center gap-1.5 px-3 pb-1.5">
          <Button
            size="sm"
            disabled={busy || hintsUsed >= MAX_HINTS}
            onClick={() => onReply({ text: `Hint ${hintsUsed + 1}`, attachments: [], quotes: [] })}
          >
            Hint
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onReply({ text: JUST_TELL_ME, attachments: [], quotes: [] })}>
            Just tell me
          </Button>
        </div>
      ) : null}
      {study ? (
        <div className="flex shrink-0 items-center gap-1.5 px-3 pb-1.5">
          <Button size="sm" disabled={!!unavailable} title={unavailable ?? "Carry on over the book, with the passage hidden"} onClick={() => onDeeper(study)}>
            <Layers />
            {study.study.turns.length ? "Open Go deeper" : "Carry on in Go deeper"}
          </Button>
        </div>
      ) : null}
      {queued ? (
        <QueuedNote
          queued={queued}
          elsewhere={queued.kind !== "reply" || queued.threadId !== thread.id}
          sending={sending}
          onSend={onSendQueued}
          onCancel={onCancelQueued}
        />
      ) : null}
      <Composer
        placeholder="Ask a follow-up…"
        disabledReason={unavailable}
        sending={sending}
        waiting={queued !== null}
        images={images}
        quotes={quotes}
        onSend={onReply}
        onStop={onStop}
      />
      <UsageRow thread={thread} />
      {viewing ? <Lightbox bookId={bookId} image={viewing} onClose={() => setViewing(null)} /> : null}
    </DropArea>
  );
}

/** The answer arriving in this thread. The only part of the chat that renders per streamed token. */
function StreamingAnswer({ live, threadId, trim, onGrow }: { live: LiveAnswer; threadId: string; /** Leave out a closing "Your turn" line. */ trim: boolean; onGrow(): void }) {
  const streaming = useStreaming(live, threadId);
  const compacting = useCompacting(live, threadId);
  useLayoutEffect(() => onGrow(), [onGrow, streaming]);
  if (streaming === null) return null;
  if (streaming === "") {
    return (
      <p role="status" className="flex items-center gap-2 text-label text-dim">
        <Spinner />
        {compacting ? "Summarizing the earlier turns for the tutor…" : "Thinking…"}
      </p>
    );
  }
  return (
    <div aria-live="polite" aria-busy="true">
      <StreamingMarkdown text={trim ? splitYourTurn(streaming).body : streaming} />
    </div>
  );
}

/**
 * The one thing an Ask answer offers the reader to try, as a prompt they can take or leave. Taking it opens Go
 * deeper on the question. It goes for good once dismissed, and stops showing for the session after two are passed over.
 */
function YourTurn({ threadId, prompt, disabled, onTake }: { threadId: string; prompt: string; disabled: boolean; onTake(): void }) {
  if (!useYourTurnShown(threadId)) return null;
  return (
    <div className="animate-rise flex items-start gap-1">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          takeYourTurn(threadId);
          onTake();
        }}
        title="Answer this over the book. Optional."
        className="press flex min-w-0 flex-1 items-start gap-2 rounded-lg bg-panel-raised px-3 py-2 text-left shadow-chip transition-colors duration-[var(--duration-fast)] hover:bg-panel-hover disabled:opacity-40"
      >
        <Layers aria-hidden className="mt-0.5 size-3.5 shrink-0 text-dim" />
        <span className="min-w-0 text-label leading-snug text-fog">
          <span className="text-dim">Your turn · </span>
          {prompt}
        </span>
      </button>
      <IconButton label="Skip this question" size="sm" onClick={() => dismissYourTurn(threadId)}>
        <X />
      </IconButton>
    </div>
  );
}

/** The head of a thread with no passage: where the reader was when they asked, as a way back there. */
function AskedAt({ thread, onJump }: { thread: GeneralThread; onJump(): void }) {
  const place = thread.anchor && (placeLabel(thread.chapterTitle, thread.anchor) ?? "where you were reading");
  if (!place) return <p className="text-caption text-dim">Asked without a passage</p>;
  return (
    <button
      type="button"
      onClick={onJump}
      title="Go back to where you asked"
      className="press flex max-w-full items-center gap-1.5 rounded-xs text-caption text-dim transition-colors duration-[var(--duration-fast)] hover:text-fog"
    >
      <CornerDownRight className="size-3 shrink-0" aria-hidden />
      <span className="truncate">Asked at {place}</span>
    </button>
  );
}

/** A message sent while an answer was coming: it goes when that answer settles, or waits here if it failed. */
function QueuedNote({
  queued,
  elsewhere,
  sending,
  onSend,
  onCancel,
}: {
  queued: QueuedMessage;
  /** It belongs to a thread other than the one on screen, or starts a new one. */
  elsewhere: boolean;
  sending: boolean;
  onSend(): void;
  onCancel(): void;
}) {
  const images = queued.attachments.length;
  const passages = queued.quotes.length;
  const words = queued.text || (images ? `${images} image${images === 1 ? "" : "s"}` : `${passages} quoted passage${passages === 1 ? "" : "s"}`);
  const link =
    "press shrink-0 rounded-xs px-1 text-fog underline decoration-dim underline-offset-2 transition-colors duration-[var(--duration-fast)] hover:text-paper";
  return (
    <div role="status" className="flex shrink-0 items-center gap-2 px-4 pb-1.5 text-caption text-dim">
      <span className="min-w-0 flex-1 truncate">
        {sending ? "Queued, sends after this answer" : "Not sent, the answer before it failed"}
        {elsewhere ? (queued.kind === "general" ? " (a new question)" : " (in another thread)") : ""}: <span className="text-fog">“{words}”</span>
      </span>
      {sending ? null : (
        <button type="button" onClick={onSend} className={link}>
          Send now
        </button>
      )}
      <button type="button" onClick={onCancel} className={link}>
        Cancel
      </button>
    </div>
  );
}

function FailureNote({ failure, onRetry, className }: { failure: FailedTurn; onRetry: (() => void) | null; className?: string }) {
  return (
    <div role="alert" className={`flex items-start gap-2.5 rounded-lg bg-panel-raised px-3 py-2.5 shadow-chip ${className ?? ""}`}>
      <CircleAlert className="mt-px size-3.5 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-label font-medium text-paper">The tutor couldn’t answer</p>
        <p className="mt-0.5 text-label leading-relaxed text-dim [overflow-wrap:anywhere]">{failure.message}</p>
      </div>
      {onRetry ? (
        <Button size="sm" onClick={onRetry} className="-my-0.5 shrink-0">
          Try again
        </Button>
      ) : null}
    </div>
  );
}
