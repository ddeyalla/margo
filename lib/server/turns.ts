import { randomUUID } from "node:crypto";
import { MAX_IMAGES_PER_MESSAGE } from "@/lib/shared/attachments";
import type { BookId, BookState, ChatMessage, Compaction, ImageAttachment, LibraryBook, ProviderId, Thread, TurnUsage } from "@/lib/shared/types";
import { readAttachment } from "./attachments";
import { getConfig } from "./config";
import { passageThread } from "./passage";
import { hold, readBookState, updateBookState } from "./store";
import { imageMessage } from "./tutor/prompt";
import { isObject, MAX_MESSAGE, parseAnchor, parseAttachmentIds, shortText } from "./validate";

/** What a chat request asks for, already validated. A new thread arrives built, with the reader's first message. */
export type TurnRequest =
  | { kind: "new"; thread: Thread }
  | { kind: "reply"; threadId: string; message: ChatMessage }
  | { kind: "retry"; threadId: string };

/** The images a message names, each one stored for this book. */
const readAttachments = async (value: unknown, bookId: BookId, dataDir: string): Promise<ImageAttachment[] | string> => {
  const ids = value === undefined ? [] : parseAttachmentIds(value, MAX_IMAGES_PER_MESSAGE);
  if (!ids) return `Attach up to ${MAX_IMAGES_PER_MESSAGE} images to a message.`;
  const images = await Promise.all(ids.map((id) => readAttachment(bookId, id, dataDir)));
  if (images.some((image) => !image)) return "An attached image is missing. Remove it and attach it again.";
  return images.flatMap((image) => (image ? [image.attachment] : []));
};

/** The reader's typed message with its images. Images sent without words ask the tutor to explain them. */
const userMessage = async (body: Record<string, unknown>, bookId: BookId, dataDir: string): Promise<ChatMessage | string> => {
  const attachments = await readAttachments(body.attachments, bookId, dataDir);
  if (typeof attachments === "string") return attachments;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length > MAX_MESSAGE) return "This message is too long.";
  if (!text && !attachments.length) return "Write a message or attach an image.";
  const message: ChatMessage = { role: "user", content: text || imageMessage(attachments.length), createdAt: new Date().toISOString() };
  if (attachments.length) message.attachments = attachments;
  return message;
};

/** A question with no passage, placed where the reader was when they asked. */
const generalThread = async (
  body: Record<string, unknown>,
  book: LibraryBook,
  provider: ProviderId,
  dataDir: string,
): Promise<Thread | string> => {
  const place = isObject(body.place) ? body.place : null;
  const anchor = place && parseAnchor(place.anchor, book.format);
  if (body.place !== null && !anchor) return "Invalid place.";
  const message = await userMessage(body, book.id, dataDir);
  if (typeof message === "string") return message;
  return {
    kind: "general",
    id: randomUUID(),
    anchor,
    chapterTitle: place && shortText(place.chapterTitle, 500),
    provider,
    sessionId: null,
    createdAt: message.createdAt,
    messages: [message],
  };
};

/** The validated turn a chat request body asks for. Images must already be stored for this book. Nothing is saved yet. */
export const parseTurnRequest = async (
  body: Record<string, unknown>,
  book: LibraryBook,
  provider: ProviderId,
  dataDir = getConfig().dataDir,
): Promise<TurnRequest | string> => {
  if (body.kind === "new" || body.kind === "general") {
    const thread = body.kind === "new" ? passageThread(body, book, provider) : await generalThread(body, book, provider, dataDir);
    return typeof thread === "string" ? thread : { kind: "new", thread };
  }
  if (typeof body.threadId !== "string") return "Invalid thread.";
  if (body.kind === "retry") return { kind: "retry", threadId: body.threadId };
  if (body.kind === "reply") {
    const message = await userMessage(body, book.id, dataDir);
    return typeof message === "string" ? message : { kind: "reply", threadId: body.threadId, message };
  }
  return "Unknown request.";
};

export interface TurnAnswer {
  text: string;
  sessionId: string | null;
  /** Stopped or failed before the answer finished. */
  partial: boolean;
  /** What the provider reported, if it did. */
  usage?: TurnUsage | null;
}

/** A turn that holds its thread: the reader's message is saved; `close` saves the answer and lets the next turn in. */
export interface OpenTurn {
  thread: Thread;
  /** Saves a summary of the thread's earlier turns, before the answer. The messages themselves are untouched. */
  compact(compaction: Compaction): Promise<Thread>;
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
  /* Sending a parked question is how it stops being parked. */
  ...(thread.kind === "passage" && thread.parkedAt ? { parkedAt: null } : {}),
});

const threadForTurn = (state: BookState, request: TurnRequest, provider: ProviderId): Thread | string => {
  if (request.kind === "new") return request.thread;
  const existing = state.threads.find((t) => t.id === request.threadId);
  if (!existing) return "This thread no longer exists.";
  if (request.kind === "retry") {
    if (existing.messages.at(-1)?.role !== "user") return "This thread has no unanswered message to retry.";
    return forProvider(existing, provider);
  }
  return { ...forProvider(existing, provider), messages: [...existing.messages, request.message] };
};

/** Appends the tutor's answer to the stored thread. An answer with no text saves nothing. */
const saveAnswer = async (bookId: BookId, thread: Thread, answer: TurnAnswer, dataDir: string): Promise<Thread> => {
  if (!answer.text.trim()) return thread;
  const reply: ChatMessage = { role: "assistant", content: answer.text, createdAt: new Date().toISOString() };
  if (answer.partial) reply.partial = true;
  if (answer.usage) reply.usage = answer.usage;
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
    return {
      thread,
      compact: async (compaction) => {
        const state = await updateBookState(
          bookId,
          (current) => ({ ...current, threads: current.threads.map((t) => (t.id === thread.id ? { ...t, compaction } : t)) }),
          dataDir,
        );
        return state.threads.find((t) => t.id === thread.id) ?? thread;
      },
      close: (answer) => saveAnswer(bookId, thread, answer, dataDir).finally(release),
    };
  } catch (error) {
    release();
    throw error;
  }
};
