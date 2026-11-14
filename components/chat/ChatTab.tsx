"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, CircleAlert, CornerDownRight, ImageIcon, MessageSquareText, Send, Trash2 } from "lucide-react";
import { Button, EmptyState, IconButton, Spinner } from "@/components/ui";
import { JUST_TELL_ME, MAX_HINTS, workState } from "@/lib/shared/work";
import { placeLabel } from "@/lib/shared/place";
import { threadLabel } from "@/lib/shared/threads";
import type { ParkedThread } from "@/lib/shared/parked";
import type { Anchor, BookId, GeneralThread, ImageAttachment, Thread } from "@/lib/shared/types";
import { Composer } from "./Composer";
import { DropArea, Lightbox, MessageImages } from "./Images";
import { Markdown } from "./Markdown";
import { useImageDraft } from "./useImageDraft";
import { awaitsAnswer, type FailedTurn, type MessageDraft, type Tutor } from "./useTutor";


const when = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** A pixel slack so a reader who is "at the bottom" keeps following a streaming answer. */
const PIN_SLACK = 40;

export function ChatTab({
  tutor,
  unavailable,
  onJump,
  onAsk,
  onSendParked,
  onReply,
  onRetry,
}: {
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
}) {
  const { active, failure } = tutor;
  if (active) {
    return (
      <ThreadView
        key={active.id}
        bookId={tutor.bookId}
        thread={active}
        streaming={tutor.streaming}
        failure={failure}
        unavailable={unavailable}
        onBack={() => tutor.open(null)}
        onJump={() => active.anchor && onJump(active.anchor)}
        onReply={onReply}
        onRetry={onRetry}
        onStop={tutor.stop}
      />
    );
  }
  return <Threads tutor={tutor} unavailable={unavailable} onJump={onJump} onAsk={onAsk} onSendParked={onSendParked} onRetry={onRetry} />;
}

/** The book's threads, and a composer for a question with no passage. */
function Threads({
  tutor,
  unavailable,
  onJump,
  onAsk,
  onSendParked,
  onRetry,
}: {
  tutor: Tutor;
  unavailable: string | null;
  onJump(anchor: Anchor): void;
  onAsk(draft: MessageDraft): void;
  onSendParked(id: string): void;
  onRetry(): void;
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
          unavailable={unavailable}
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
          body="Select text in the book, then choose Explain, Go deeper, Work it out, Explain it back or Ask… Or ask below, and paste or drop an image to show the tutor."
        />
      )}
      <Composer
        placeholder="Ask about the book, or paste an image…"
        disabledReason={unavailable}
        sending={tutor.sending}
        images={images}
        onSend={onAsk}
        onStop={tutor.stop}
      />
    </DropArea>
  );
}

/** Questions saved on a passage, waiting to be sent. Nothing here has been asked. */
function ParkedList({
  parked,
  unavailable,
  onJump,
  onSend,
  onDiscard,
}: {
  parked: ParkedThread[];
  unavailable: string | null;
  onJump(anchor: Anchor): void;
  onSend(id: string): void;
  onDiscard(id: string): void;
}) {
  return (
    <section aria-label="Parked questions" className="mb-2">
      <p className="px-2 pb-1.5 pt-1 text-[11px] text-dim">Parked · {parked.length}</p>
      <ul className="flex flex-col gap-0.5">
        {parked.map((thread) => {
          const place = placeLabel(thread.chapterTitle, thread.anchor);
          return (
            <li key={thread.id} className="flex flex-col gap-1.5 rounded-lg px-2.5 py-2 hover:bg-panel-raised/60">
              <button
                type="button"
                onClick={() => onJump(thread.anchor)}
                title={place ? `Go to this passage · ${place}` : "Go to this passage"}
                className="press line-clamp-2 rounded-xs text-left font-reading text-[13px] leading-snug text-dim transition-colors duration-[var(--duration-fast)] hover:text-fog"
              >
                {thread.quote}
              </button>
              <p className="whitespace-pre-wrap break-words text-body leading-snug text-paper">{thread.messages[0]?.content}</p>
              <div className="flex items-center gap-1">
                <Button size="sm" disabled={!!unavailable} title={unavailable ?? "Send this question to the tutor"} onClick={() => onSend(thread.id)}>
                  <Send />
                  Ask now
                </Button>
                <span className="min-w-0 flex-1 truncate px-1 text-[11px] text-dim">{place}</span>
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
  unavailable,
  onJump,
  onSend,
  onDiscard,
  onOpen,
}: {
  threads: Thread[];
  parked: ParkedThread[];
  unavailable: string | null;
  onJump(anchor: Anchor): void;
  onSend(id: string): void;
  onDiscard(id: string): void;
  onOpen(thread: Thread): void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      {parked.length ? <ParkedList parked={parked} unavailable={unavailable} onJump={onJump} onSend={onSend} onDiscard={onDiscard} /> : null}
      {threads.length ? (
        <p className="px-2 pb-1.5 pt-1 text-[11px] text-dim">
          {threads.length} {threads.length === 1 ? "thread" : "threads"} in this book
        </p>
      ) : null}
      <ul className="flex flex-col gap-0.5">
        {threads.map((thread) => {
          const first = thread.messages[0]?.content ?? "";
          const label = threadLabel(thread);
          const place = thread.anchor && placeLabel(thread.chapterTitle, thread.anchor);
          return (
            <li key={thread.id}>
              <button
                type="button"
                onClick={() => onOpen(thread)}
                title={place ?? undefined}
                className="press flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors duration-[var(--duration-fast)] hover:bg-panel-raised focus-visible:bg-panel-raised"
              >
                {thread.kind === "passage" ? (
                  <span className="line-clamp-2 font-reading text-[13px] leading-snug text-prose">{thread.quote}</span>
                ) : (
                  <span className="line-clamp-2 text-body leading-snug text-paper">
                    {thread.messages[0]?.attachments?.length ? (
                      <ImageIcon className="mr-1.5 inline size-3.5 align-[-2px] text-dim" aria-label="With an image" />
                    ) : null}
                    {first}
                  </span>
                )}
                <span className="flex min-w-0 items-center gap-2 text-[11px] text-dim">
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
  streaming,
  failure,
  unavailable,
  onBack,
  onJump,
  onReply,
  onRetry,
  onStop,
}: {
  bookId: BookId;
  thread: Thread;
  streaming: string | null;
  failure: FailedTurn | null;
  unavailable: string | null;
  onBack(): void;
  onJump(): void;
  onReply(draft: MessageDraft): void;
  onRetry(): void;
  onStop(): void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const images = useImageDraft(bookId);
  const [viewing, setViewing] = useState<ImageAttachment | null>(null);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller && pinned.current) scroller.scrollTop = scroller.scrollHeight;
  }, [thread.messages.length, streaming, failure]);

  /* The reader's last message went unanswered: stopped before the first word, or failed. */
  const unanswered = streaming === null && awaitsAnswer(thread);
  const { leading, hintsUsed } = workState(thread);
  const busy = streaming !== null || !!unavailable;

  return (
    <DropArea onFiles={images.add} enabled={!unavailable} className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center px-2">
        <button
          type="button"
          onClick={onBack}
          className="press inline-flex h-7 items-center gap-1 rounded-sm pl-1 pr-2 text-label text-dim transition-colors duration-[var(--duration-fast)] hover:bg-white/[0.06] hover:text-paper"
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
            className="group block w-full rounded-lg bg-panel-raised p-3 text-left transition-colors duration-[var(--duration-fast)] hover:bg-panel-hover"
          >
            <span className="line-clamp-6 whitespace-pre-line font-reading text-[14px] leading-relaxed text-prose">{thread.quote}</span>
            <span className="mt-2 flex min-w-0 items-center gap-1.5 text-[11px] text-dim group-hover:text-fog">
              <CornerDownRight className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{placeLabel(thread.chapterTitle, thread.anchor) ?? "Go to passage"}</span>
            </span>
          </button>
        ) : (
          <AskedAt thread={thread} onJump={onJump} />
        )}

        <div className="mt-4 flex flex-col gap-4">
          {thread.messages.map((message, index) =>
            message.role === "user" ? (
              <div key={index} className="flex flex-col items-end gap-1.5 pl-8">
                {message.attachments?.length ? <MessageImages bookId={bookId} images={message.attachments} onOpen={setViewing} /> : null}
                <p className="min-w-0 whitespace-pre-wrap break-words rounded-[14px] rounded-br-[5px] bg-panel-hover px-3.5 py-2.5 text-body text-paper">
                  {message.content}
                </p>
              </div>
            ) : (
              <div key={index}>
                <Markdown text={message.content} />
                {message.partial ? <p className="mt-1.5 text-[11px] text-dim">Stopped before the answer finished.</p> : null}
              </div>
            ),
          )}
          {streaming === "" ? (
            <p role="status" className="flex items-center gap-2 text-label text-dim">
              <Spinner />
              Thinking…
            </p>
          ) : streaming !== null ? (
            <div aria-live="polite" aria-busy="true">
              <Markdown text={streaming} />
            </div>
          ) : null}
          {failure ? (
            <FailureNote failure={failure} onRetry={unanswered ? onRetry : null} />
          ) : unanswered ? (
            <p className="flex items-center gap-2 text-[11px] text-dim">
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
            onClick={() => onReply({ text: `Hint ${hintsUsed + 1}`, attachments: [] })}
          >
            Hint
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onReply({ text: JUST_TELL_ME, attachments: [] })}>
            Just tell me
          </Button>
        </div>
      ) : null}
      <Composer
        placeholder="Ask a follow-up…"
        disabledReason={unavailable}
        sending={streaming !== null}
        images={images}
        onSend={onReply}
        onStop={onStop}
      />
      {viewing ? <Lightbox bookId={bookId} image={viewing} onClose={() => setViewing(null)} /> : null}
    </DropArea>
  );
}

/** The head of a thread with no passage: where the reader was when they asked, as a way back there. */
function AskedAt({ thread, onJump }: { thread: GeneralThread; onJump(): void }) {
  const place = thread.anchor && (placeLabel(thread.chapterTitle, thread.anchor) ?? "where you were reading");
  if (!place) return <p className="text-[11px] text-dim">Asked without a passage</p>;
  return (
    <button
      type="button"
      onClick={onJump}
      title="Go back to where you asked"
      className="press flex max-w-full items-center gap-1.5 rounded-xs text-[11px] text-dim transition-colors duration-[var(--duration-fast)] hover:text-fog"
    >
      <CornerDownRight className="size-3 shrink-0" aria-hidden />
      <span className="truncate">Asked at {place}</span>
    </button>
  );
}

function FailureNote({ failure, onRetry, className }: { failure: FailedTurn; onRetry: (() => void) | null; className?: string }) {
  return (
    <div role="alert" className={`flex items-start gap-2.5 rounded-lg bg-panel-raised px-3 py-2.5 ${className ?? ""}`}>
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
