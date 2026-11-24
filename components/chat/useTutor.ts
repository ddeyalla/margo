"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createStore, useStableCallback, useStore, type Store } from "@/components/ui/store";
import { patchBookState } from "@/lib/client/api";
import { streamChat } from "@/lib/client/chat";
import { useUnsentText } from "@/lib/client/unsent";
import type { ChatRequest, QuestionPlace } from "@/lib/shared/chat";
import { isParked, parkedFirst } from "@/lib/shared/parked";
import { repairDiagrams } from "./mermaid";
import type { BookId, ImageAttachment, ProviderId, SelectionContext, Thread, TutorAction } from "@/lib/shared/types";

/** What the reader wrote in the composer: words, images, or both. */
export interface MessageDraft {
  text: string;
  attachments: ImageAttachment[];
}

const ids = (draft: MessageDraft) => draft.attachments.map((attachment) => attachment.id);

/** A typed message: the only kind that can wait for the answer before it. */
export type QueuedMessage = Extract<ChatRequest, { kind: "general" | "reply" }>;

/** A turn that ended without a full answer. */
export interface FailedTurn {
  threadId: string | null;
  message: string;
  /** The request to resend when it failed before the server saved a thread. */
  request: ChatRequest | null;
}

/** The answer streaming in, and the thread it belongs to. `compacting` while the tutor summarizes older turns first. */
export type LiveAnswer = Store<{ threadId: string; text: string; compacting: boolean } | null>;

/** The answer streaming into `threadId`, or null when that thread isn't the one answering. Only its subscriber re-renders per token. */
export const useStreaming = (live: LiveAnswer, threadId: string) => useStore(live, (answer) => (answer && answer.threadId === threadId ? answer.text : null));

/** Whether `threadId`'s older turns are being summarized before its answer starts. */
export const useCompacting = (live: LiveAnswer, threadId: string) => useStore(live, (answer) => answer?.threadId === threadId && answer.compacting);

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
  const setActiveId = useCallback(
    (id: string | null) => {
      setActiveIdState(id);
      void patchBookState(bookId, { activeThreadId: id });
    },
    [bookId],
  );
  /* Outside React state so a streamed token re-renders the answer bubble, not the whole workspace. */
  const [live] = useState<LiveAnswer>(() => createStore(null));
  const frame = useRef(0);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<FailedTurn | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /* A message the reader sent while an answer was still coming. It goes once that answer settles. The ref is
     what the finishing turn reads; the state is what the chat shows. */
  const queue = useRef<QueuedMessage | null>(null);
  const [queued, setQueuedState] = useState<QueuedMessage | null>(null);
  const setQueued = (request: QueuedMessage | null) => {
    queue.current = request;
    setQueuedState(request);
  };
  useUnsentText(queued !== null);

  /* Cleared only once the finished turn has committed, so the saved answer replaces the bubble with no blank frame between. */
  useLayoutEffect(() => {
    if (!sending) live.set(null);
  }, [sending, live]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const upsert = (thread: Thread) =>
    setThreads((current) =>
      current.some((t) => t.id === thread.id) ? current.map((t) => (t.id === thread.id ? thread : t)) : [...current, thread],
    );

  /** Swaps in the answer's text once its broken diagrams come back fixed. The rest of the thread is left as it is now. */
  const fixDiagrams = async (thread: Thread) => {
    const answer = thread.messages.at(-1);
    if (!answer) return;
    const content = await repairDiagrams(bookId, thread.id, answer);
    if (content === null) return;
    setThreads((current) =>
      current.map((t) =>
        t.id === thread.id
          ? { ...t, messages: t.messages.map((m) => (m.role === "assistant" && m.createdAt === answer.createdAt ? { ...m, content, diagramsRepaired: true } : m)) }
          : t,
      ),
    );
  };

  /** Reads the threads again from the server, for a turn whose outcome the client never saw. */
  const reload = async () => {
    try {
      const response = await fetch(`/api/books/${bookId}/state`, { cache: "no-store" });
      if (response.ok) setThreads(((await response.json()) as { threads: Thread[] }).threads);
    } catch {
      /* Offline; the list stays as it was. */
    }
  };

  /* One request at a time, whichever thread it is for: starting another would cut the first one's answer off. */
  const run = async (request: ChatRequest) => {
    if (abortRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    /* A message already waiting when nothing was running is one held after a failure; only Send now sends it. */
    const held = queue.current;
    setFailure(null);
    setSending(true);
    live.set(null);
    let thread: Thread | null = null;
    let text = "";
    let compacting = false;
    let error: string | null = null;
    let finished = false;
    /* Tokens arrive faster than frames; the bubble takes the text so far once per frame. */
    const publish = () => {
      frame.current = 0;
      if (thread) live.set({ threadId: thread.id, text, compacting: compacting && !text });
    };
    try {
      for await (const event of streamChat(request, controller.signal)) {
        if (event.type === "thread") {
          thread = event.thread;
          upsert(thread);
          setActiveId(thread.id);
          cancelAnimationFrame(frame.current);
          publish();
        } else if (event.type === "compacting") {
          compacting = true;
          publish();
        } else if (event.type === "text") {
          text += event.delta;
          if (thread && !frame.current) frame.current = requestAnimationFrame(publish);
        } else if (event.type === "error") {
          error = event.message;
        } else {
          finished = true;
          thread = event.thread;
          upsert(thread);
          void fixDiagrams(thread);
        }
      }
      if (!finished) error ??= "The connection to the tutor dropped before the answer finished.";
    } catch (cause) {
      if (!controller.signal.aborted) error = cause instanceof Error ? cause.message : "The tutor could not be reached.";
    }
    cancelAnimationFrame(frame.current);
    frame.current = 0;

    /* Stopped or cut off mid-answer: the server saves what was written so far, marked partial. */
    if (!finished && thread && text.trim()) {
      upsert({
        ...thread,
        messages: [...thread.messages, { role: "assistant", content: text, createdAt: new Date().toISOString(), partial: true }],
      });
    }
    abortRef.current = null;
    setSending(false);
    /* The server may hold a thread this window never saw: a new question stopped before its first event, or a
       thread that is gone or has nothing to retry. Ask it, twice, since a stopped request may still be saving. */
    const aborted = controller.signal.aborted;
    if (!thread && (aborted ? !("threadId" in request) : "threadId" in request)) {
      void reload();
      setTimeout(() => void reload(), 1500);
    }
    if (error && !aborted) {
      const inThread = "threadId" in request ? request.threadId : null;
      setFailure({ threadId: thread?.id ?? inThread, message: error, request: thread || inThread ? null : request });
    }
    /* The queued message goes now, unless the answer before it failed: then it waits for the reader to send it. */
    const next = queue.current;
    if (next && next !== held && (!error || aborted)) {
      setQueued(null);
      void run(next);
    }
  };

  /** Sends a typed message, or queues it while another answer is coming. One message waits at a time, and while
      one waits nothing new is taken, so messages go in the order they were written. */
  const send = (request: QueuedMessage) => {
    if (queue.current) return;
    if (!abortRef.current) void run(request);
    else setQueued(request);
  };

  const active = useMemo(() => threads.find((t) => t.id === activeId) ?? null, [threads, activeId]);
  const shownFailure = failure && (failure.threadId === null || failure.threadId === activeId) ? failure : null;

  const start = useStableCallback((action: TutorAction, selection: SelectionContext, question: string | null, provider: ProviderId) => {
    const { text, before, after, anchor, chapterTitle } = selection;
    void run({ kind: "new", bookId, provider, action, question, selection: { text, before, after, anchor, chapterTitle } });
  });

  /** Starts a thread with no passage, placed where the reader is. */
  const ask = useStableCallback((draft: MessageDraft, place: QuestionPlace | null, provider: ProviderId) => {
    send({ kind: "general", bookId, provider, text: draft.text, attachments: ids(draft), place });
  });

  const reply = useStableCallback((draft: MessageDraft, provider: ProviderId) => {
    if (activeId) send({ kind: "reply", bookId, provider, threadId: activeId, text: draft.text, attachments: ids(draft) });
  });

  /** Sends the queued message now: the one held back because the answer before it failed. */
  const sendQueued = useStableCallback(() => {
    const next = queue.current;
    if (!next || abortRef.current) return;
    setQueued(null);
    void run(next);
  });

  const cancelQueued = useStableCallback(() => setQueued(null));

  /** Asks again for the active thread's unanswered message, or resends a first turn the server never saved. */
  const retry = useStableCallback((provider: ProviderId) => {
    if (active && awaitsAnswer(active)) void run({ kind: "retry", bookId, provider, threadId: active.id });
    else if (shownFailure?.request) void run({ ...shownFailure.request, provider });
  });

  const stop = useCallback(() => abortRef.current?.abort(), []);

  /** Saves a question on a passage without asking it. Resolves to whether it was saved; the tutor is not called. */
  const park = useStableCallback(async (selection: SelectionContext, question: string, provider: ProviderId | null): Promise<boolean> => {
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
  });

  const open = useStableCallback((id: string | null) => {
    setFailure((current) => (current && current.threadId === id ? current : null));
    setActiveId(id);
  });

  /** Sends a parked question to the tutor, as an Ask would. It becomes an ordinary thread. */
  const unpark = useStableCallback((id: string, provider: ProviderId) => {
    const thread = threads.find((t) => t.id === id);
    if (!thread || !isParked(thread) || abortRef.current) return;
    /* Opened first, so a failure before the answer starts shows on the thread being asked. */
    open(id);
    void run({ kind: "retry", bookId, provider, threadId: id });
  });

  /** Deletes a parked question. It goes from the list at once and comes back if the server didn't delete it. */
  const discard = useStableCallback(async (id: string) => {
    const thread = threads.find((t) => t.id === id);
    if (!thread || !isParked(thread)) return;
    setThreads((current) => current.filter((t) => t.id !== id));
    const deleted = await fetch(`/api/books/${bookId}/parked`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).then(
      (response) => response.ok,
      () => false,
    );
    if (!deleted) setThreads((current) => (current.some((t) => t.id === id) ? current : [...current, thread]));
  });

  const listed = useMemo(() => threads.filter((t) => !isParked(t)).sort(newestFirst), [threads]);
  const parked = useMemo(() => parkedFirst(threads), [threads]);

  return useMemo(
    () => ({
      bookId,
      threads: listed,
      /** Questions saved on a passage and not yet sent, newest first. */
      parked,
      active,
      /** The answer streaming in; read it with useStreaming. */
      live,
      sending,
      failure: shownFailure,
      /** A message waiting for the current answer to settle. */
      queued,
      sendQueued,
      cancelQueued,
      start,
      park,
      unpark,
      discard,
      ask,
      reply,
      retry,
      stop,
      open,
    }),
    [bookId, listed, parked, active, live, sending, shownFailure, queued, sendQueued, cancelQueued, start, park, unpark, discard, ask, reply, retry, stop, open],
  );
}

export type Tutor = ReturnType<typeof useTutor>;
