"use client";

import { useRef, useState } from "react";
import { streamChat } from "@/lib/client/chat";
import type { ChatRequest } from "@/lib/shared/chat";
import type { BookId, ProviderId, SelectionContext, Thread, TutorAction } from "@/lib/shared/types";

/** A turn that ended without an answer. Its thread (with the unanswered message) is shown but was never saved. */
export interface FailedTurn {
  threadId: string | null;
  thread: Thread | null;
  message: string;
  /** Resends the same request; absent when part of an answer was saved. */
  retry: ChatRequest | null;
}

const isSaved = (thread: Thread) => thread.messages.at(-1)?.role === "assistant";

const newestFirst = (a: Thread, b: Thread) => b.createdAt.localeCompare(a.createdAt);

/**
 * The book's tutor threads. Saved threads mirror the server; the turn in
 * flight and the last failed turn live beside them until the server has
 * saved an answer, so an unanswered message never looks saved.
 */
export function useTutor(bookId: BookId, initialThreads: Thread[]) {
  const [threads, setThreads] = useState(initialThreads);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [live, setLive] = useState<{ thread: Thread; text: string } | null>(null);
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
          setActiveId(thread.id);
          setLive({ thread, text });
        } else if (event.type === "text") {
          text += event.delta;
          if (thread) setLive({ thread, text });
        } else if (event.type === "error") {
          error = event.message;
        } else {
          finished = true;
          thread = event.thread;
          if (isSaved(event.thread)) upsert(event.thread);
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
      const answered = text.trim().length > 0;
      setFailure({
        threadId: thread?.id ?? (request.kind === "reply" ? request.threadId : null),
        thread: answered ? null : thread,
        message: error,
        retry: answered ? null : request,
      });
    }
  };

  const start = (action: TutorAction, selection: SelectionContext, question: string | null, provider: ProviderId) => {
    const { text, before, after, anchor, chapterTitle } = selection;
    void run({ kind: "new", bookId, provider, action, question, selection: { text, before, after, anchor, chapterTitle } });
  };

  const reply = (text: string, provider: ProviderId) => {
    if (activeId) void run({ kind: "reply", bookId, provider, threadId: activeId, text });
  };

  const retry = (provider: ProviderId) => {
    if (failure?.retry) void run({ ...failure.retry, provider });
  };

  const stop = () => abortRef.current?.abort();

  const open = (id: string | null) => {
    setFailure((current) => (current && current.threadId === id ? current : null));
    setActiveId(id);
  };

  const liveThread = live?.thread ?? null;
  const active =
    (liveThread?.id === activeId ? liveThread : null) ??
    (failure?.thread?.id === activeId ? failure.thread : null) ??
    threads.find((t) => t.id === activeId) ??
    null;
  const listed = [...threads];
  if (liveThread && !threads.some((t) => t.id === liveThread.id)) listed.push(liveThread);

  return {
    threads: listed.sort(newestFirst),
    active,
    /** The answer streaming into the active thread, or null when it isn't the one answering. */
    streaming: live && live.thread.id === activeId ? live.text : null,
    sending,
    failure: failure && (failure.threadId === null || failure.threadId === activeId) ? failure : null,
    start,
    reply,
    retry,
    stop,
    open,
  };
}

export type Tutor = ReturnType<typeof useTutor>;
