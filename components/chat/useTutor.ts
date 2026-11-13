"use client";

import { useRef, useState } from "react";
import { streamChat } from "@/lib/client/chat";
import type { ChatRequest } from "@/lib/shared/chat";
import type { BookId, ProviderId, SelectionContext, Thread, TutorAction } from "@/lib/shared/types";

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
export function useTutor(bookId: BookId, initialThreads: Thread[]) {
  const [threads, setThreads] = useState(initialThreads);
  const [activeId, setActiveId] = useState<string | null>(null);
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
      setFailure({
        threadId: thread?.id ?? (request.kind === "new" ? null : request.threadId),
        message: error,
        request: thread || request.kind !== "new" ? null : request,
      });
    }
  };

  const start = (action: TutorAction, selection: SelectionContext, question: string | null, provider: ProviderId) => {
    const { text, before, after, anchor, chapterTitle } = selection;
    void run({ kind: "new", bookId, provider, action, question, selection: { text, before, after, anchor, chapterTitle } });
  };

  const active = threads.find((t) => t.id === activeId) ?? null;
  const shownFailure = failure && (failure.threadId === null || failure.threadId === activeId) ? failure : null;

  const reply = (text: string, provider: ProviderId) => {
    if (activeId) void run({ kind: "reply", bookId, provider, threadId: activeId, text });
  };

  /** Asks again for the active thread's unanswered message, or resends a first turn the server never saved. */
  const retry = (provider: ProviderId) => {
    if (active && awaitsAnswer(active)) void run({ kind: "retry", bookId, provider, threadId: active.id });
    else if (shownFailure?.request) void run({ ...shownFailure.request, provider });
  };

  const stop = () => abortRef.current?.abort();

  const open = (id: string | null) => {
    setFailure((current) => (current && current.threadId === id ? current : null));
    setActiveId(id);
  };

  return {
    threads: [...threads].sort(newestFirst),
    active,
    /** The answer streaming into the active thread, or null when it isn't the one answering. */
    streaming: live && live.threadId === activeId ? live.text : null,
    sending,
    failure: shownFailure,
    start,
    reply,
    retry,
    stop,
    open,
  };
}

export type Tutor = ReturnType<typeof useTutor>;
