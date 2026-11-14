"use client";

import { useRef, useState } from "react";
import { patchBookState } from "@/lib/client/api";
import { streamChat } from "@/lib/client/chat";
import type { ChatRequest, QuestionPlace } from "@/lib/shared/chat";
import { isParked, parkedFirst } from "@/lib/shared/parked";
import type { BookId, ImageAttachment, ProviderId, SelectionContext, Thread, TutorAction } from "@/lib/shared/types";

/** What the reader wrote in the composer: words, images, or both. */
export interface MessageDraft {
  text: string;
  attachments: ImageAttachment[];
}

const ids = (draft: MessageDraft) => draft.attachments.map((attachment) => attachment.id);

/** A turn that ended without a full answer. */
export interface FailedTurn {
  threadId: string | null;
  message: string;
  /** The request to resend when it failed before the server saved a thread. */
  request: ChatRequest | null;
}

const newestFirst = (a: Thread, b: Thread) => b.createdAt.localeCompare(a.createdAt);

/** The reader's last message has no answer yet: the turn was stopped early or failed. */
export const awaitsAnswer = (thread: Thread) => thread.messages.at(-1)?.role === "user";

/**
 * The book's tutor threads, mirroring the server. The server saves the
 * reader's message before the tutor starts, so a thread appears as soon as the
 * stream opens; the answer streams beside it until it is saved too.
 */
export function useTutor(bookId: BookId, initialThreads: Thread[], initialActiveId: string | null = null) {
  const [threads, setThreads] = useState(initialThreads);
  const [activeId, setActiveIdState] = useState(initialActiveId);
  /* The open thread is remembered for the next visit to this book. */
  const setActiveId = (id: string | null) => {
    setActiveIdState(id);
    void patchBookState(bookId, { activeThreadId: id });
  };
  const [live, setLive] = useState<{ threadId: string; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<FailedTurn | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const upsert = (thread: Thread) =>
    setThreads((current) =>
      current.some((t) => t.id === thread.id) ? current.map((t) => (t.id === thread.id ? thread : t)) : [...current, thread],
    );

  const run = async (request: ChatRequest) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setFailure(null);
    setSending(true);
    let thread: Thread | null = null;
    let text = "";
    let error: string | null = null;
    let finished = false;
    try {
      for await (const event of streamChat(request, controller.signal)) {
        if (event.type === "thread") {
          thread = event.thread;
          upsert(thread);
          setActiveId(thread.id);
          setLive({ threadId: thread.id, text });
        } else if (event.type === "text") {
          text += event.delta;
          if (thread) setLive({ threadId: thread.id, text });
        } else if (event.type === "error") {
          error = event.message;
        } else {
          finished = true;
          thread = event.thread;
          upsert(thread);
        }
      }
      if (!finished) error ??= "The connection to the tutor dropped before the answer finished.";
    } catch (cause) {
      if (!controller.signal.aborted) error = cause instanceof Error ? cause.message : "The tutor could not be reached.";
    }

    /* Stopped or cut off mid-answer: the server saves what was written so far, marked partial. */
    if (!finished && thread && text.trim()) {
      upsert({
        ...thread,
        messages: [...thread.messages, { role: "assistant", content: text, createdAt: new Date().toISOString(), partial: true }],
      });
    }
    if (abortRef.current !== controller) return;
    abortRef.current = null;
    setSending(false);
    setLive(null);
    if (error && !controller.signal.aborted) {
      const inThread = "threadId" in request ? request.threadId : null;
      setFailure({ threadId: thread?.id ?? inThread, message: error, request: thread || inThread ? null : request });
    }
  };

  const start = (action: TutorAction, selection: SelectionContext, question: string | null, provider: ProviderId) => {
    const { text, before, after, anchor, chapterTitle } = selection;
    void run({ kind: "new", bookId, provider, action, question, selection: { text, before, after, anchor, chapterTitle } });
  };

  const active = threads.find((t) => t.id === activeId) ?? null;
  const shownFailure = failure && (failure.threadId === null || failure.threadId === activeId) ? failure : null;

  /** Starts a thread with no passage, placed where the reader is. */
  const ask = (draft: MessageDraft, place: QuestionPlace | null, provider: ProviderId) => {
    void run({ kind: "general", bookId, provider, text: draft.text, attachments: ids(draft), place });
  };

  const reply = (draft: MessageDraft, provider: ProviderId) => {
    if (activeId) void run({ kind: "reply", bookId, provider, threadId: activeId, text: draft.text, attachments: ids(draft) });
  };

  /** Asks again for the active thread's unanswered message, or resends a first turn the server never saved. */
  const retry = (provider: ProviderId) => {
    if (active && awaitsAnswer(active)) void run({ kind: "retry", bookId, provider, threadId: active.id });
    else if (shownFailure?.request) void run({ ...shownFailure.request, provider });
  };

  const stop = () => abortRef.current?.abort();

  /** Saves a question on a passage without asking it. Resolves to whether it was saved; the tutor is not called. */
  const park = async (selection: SelectionContext, question: string, provider: ProviderId | null): Promise<boolean> => {
    const { text, before, after, anchor, chapterTitle } = selection;
    try {
      const response = await fetch(`/api/books/${bookId}/parked`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, question, selection: { text, before, after, anchor, chapterTitle } }),
      });
      const body = (await response.json().catch(() => null)) as { thread?: Thread } | null;
      if (!response.ok || !body?.thread) return false;
      upsert(body.thread);
      return true;
    } catch {
      return false;
    }
  };

  /** Sends a parked question to the tutor, as an Ask would. It becomes an ordinary thread. */
  const unpark = (id: string, provider: ProviderId) => {
    const thread = threads.find((t) => t.id === id);
    if (thread && isParked(thread)) void run({ kind: "retry", bookId, provider, threadId: id });
  };

  /** Deletes a parked question. */
  const discard = (id: string) => {
    const thread = threads.find((t) => t.id === id);
    if (!thread || !isParked(thread)) return;
    setThreads((current) => current.filter((t) => t.id !== id));
    void fetch(`/api/books/${bookId}/parked`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => undefined);
  };

  const open = (id: string | null) => {
    setFailure((current) => (current && current.threadId === id ? current : null));
    setActiveId(id);
  };

  return {
    bookId,
    threads: threads.filter((t) => !isParked(t)).sort(newestFirst),
    /** Questions saved on a passage and not yet sent, newest first. */
    parked: parkedFirst(threads),
    active,
    /** The answer streaming into the active thread, or null when it isn't the one answering. */
    streaming: live && live.threadId === activeId ? live.text : null,
    sending,
    failure: shownFailure,
    start,
    park,
    unpark,
    discard,
    ask,
    reply,
    retry,
    stop,
    open,
  };
}

export type Tutor = ReturnType<typeof useTutor>;
