import type { BookId, BookState, ChatMessage, ProviderId, Thread } from "@/lib/shared/types";
import { getConfig } from "./config";
import { hold, readBookState, updateBookState } from "./store";

/** What a chat request asks for, already validated. A new thread arrives built, with the reader's first message. */
export type TurnRequest =
  | { kind: "new"; thread: Thread }
  | { kind: "reply"; threadId: string; text: string }
  | { kind: "retry"; threadId: string };

export interface TurnAnswer {
  text: string;
  sessionId: string | null;
  /** Stopped or failed before the answer finished. */
  partial: boolean;
}

/** A turn that holds its thread: the reader's message is saved; `close` saves the answer and lets the next turn in. */
export interface OpenTurn {
  thread: Thread;
  close(answer: TurnAnswer): Promise<Thread>;
}

const putThread = (state: BookState, thread: Thread): BookState => ({
  ...state,
  threads: state.threads.some((t) => t.id === thread.id)
    ? state.threads.map((t) => (t.id === thread.id ? thread : t))
    : [...state.threads, thread],
});

/** A different provider can't resume another's session; it replays the transcript instead. */
const forProvider = (thread: Thread, provider: ProviderId): Thread => ({
  ...thread,
  provider,
  sessionId: thread.provider === provider ? thread.sessionId : null,
});

const threadForTurn = (state: BookState, request: TurnRequest, provider: ProviderId): Thread | string => {
  if (request.kind === "new") return request.thread;
  const existing = state.threads.find((t) => t.id === request.threadId);
  if (!existing) return "This thread no longer exists.";
  if (request.kind === "retry") {
    if (existing.messages.at(-1)?.role !== "user") return "This thread has no unanswered message to retry.";
    return forProvider(existing, provider);
  }
  const message: ChatMessage = { role: "user", content: request.text, createdAt: new Date().toISOString() };
  return { ...forProvider(existing, provider), messages: [...existing.messages, message] };
};

/** Appends the tutor's answer to the stored thread. An answer with no text saves nothing. */
const saveAnswer = async (bookId: BookId, thread: Thread, answer: TurnAnswer, dataDir: string): Promise<Thread> => {
  if (!answer.text.trim()) return thread;
  const reply: ChatMessage = { role: "assistant", content: answer.text, createdAt: new Date().toISOString() };
  if (answer.partial) reply.partial = true;
  const state = await updateBookState(
    bookId,
    (current) => ({
      ...current,
      threads: current.threads.map((t) =>
        t.id === thread.id ? { ...t, sessionId: answer.sessionId, messages: [...t.messages, reply] } : t,
      ),
    }),
    dataDir,
  );
  return state.threads.find((t) => t.id === thread.id) ?? thread;
};

/**
 * Starts a turn. It waits for the thread's previous turn to save its answer,
 * so a follow-up sent right after Stop reads the partial answer and lands
 * after it. The reader's message is saved before the tutor starts, so it
 * survives a stop, a failure or a closed tab.
 */
export const openTurn = async (
  bookId: BookId,
  request: TurnRequest,
  provider: ProviderId,
  dataDir = getConfig().dataDir,
): Promise<OpenTurn | string> => {
  const release = await hold(`turn:${bookId}:${request.kind === "new" ? request.thread.id : request.threadId}`);
  try {
    const thread = threadForTurn(await readBookState(bookId, dataDir), request, provider);
    if (typeof thread === "string") {
      release();
      return thread;
    }
    await updateBookState(bookId, (state) => putThread(state, thread), dataDir);
    return { thread, close: (answer) => saveAnswer(bookId, thread, answer, dataDir).finally(release) };
  } catch (error) {
    release();
    throw error;
  }
};
