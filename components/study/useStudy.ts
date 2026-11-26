"use client";

import { useRef, useState } from "react";
import type { Tutor } from "@/components/chat/useTutor";
import { useStableCallback } from "@/components/ui/store";
import { studyStep, type StudyRequest } from "@/lib/client/api";
import { isStudy, type StudyThread } from "@/lib/shared/study";
import type { BookId, ProviderId, SelectionContext } from "@/lib/shared/types";

type Start = Extract<StudyRequest, { op: "start" }>;

/**
 * The Go deeper sheet's place in the book: closed, opening on a passage, or open on a thread. The turn itself lives
 * on the thread, saved with the book, so closing the sheet loses nothing and any study thread can be opened again.
 */
export function useStudy(bookId: BookId, tutor: Tutor, provider: ProviderId | null) {
  /* Null while closed. `threadId` is null while the turn is being opened, which can wait on the tutor for a question. */
  const [view, setView] = useState<{ threadId: string | null; error: string | null } | null>(null);
  const opening = useRef<{ step: Start; abort: AbortController } | null>(null);

  const begin = async (step: Start) => {
    opening.current?.abort.abort();
    const abort = new AbortController();
    opening.current = { step, abort };
    setView({ threadId: null, error: null });
    const result = await studyStep(bookId, step, abort.signal);
    if (opening.current?.abort !== abort || !result) return;
    if ("error" in result) {
      setView({ threadId: null, error: result.error });
      return;
    }
    opening.current = null;
    tutor.adopt(result.thread);
    setView({ threadId: result.thread.id, error: null });
  };

  /** Opens the reader's turn on a selected passage: a turn already open on it, an explain-back, or a new question. */
  const open = useStableCallback((selection: SelectionContext) => {
    if (!provider) return;
    const { text, before, after, anchor, chapterTitle } = selection;
    void begin({ op: "start", provider, selection: { text, before, after, anchor, chapterTitle } });
  });

  /** Opens the turn an answer's "Your turn" prompt offers, from the thread that answer is in. */
  const openFrom = useStableCallback((threadId: string) => {
    if (provider) void begin({ op: "start", provider, from: threadId });
  });

  /** Opens a study thread again where it was left. */
  const resume = useStableCallback((threadId: string) => setView({ threadId, error: null }));

  const retry = useStableCallback(() => {
    if (opening.current) void begin(opening.current.step);
  });

  const close = useStableCallback(() => {
    opening.current?.abort.abort();
    opening.current = null;
    setView(null);
  });

  const found = view?.threadId ? tutor.threads.find((thread) => thread.id === view.threadId) : undefined;
  const thread: StudyThread | null = isStudy(found) ? found : null;

  /* A thread deleted from under the sheet, in another window. */
  const gone = view?.threadId && !thread ? "This thread no longer exists." : null;

  return { shown: view !== null, thread, error: view?.error ?? gone, canRetry: !gone, open, openFrom, resume, retry, close };
}

export type StudyView = ReturnType<typeof useStudy>;
