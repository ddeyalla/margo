import type { BookId, LibraryBook, PassageThread, Thread } from "@/lib/shared/types";
import { isParked } from "@/lib/shared/parked";
import { getConfig } from "./config";
import { updateBookState } from "./store";
import { passageThread } from "./passage";
import { isProviderId } from "./tutor/providers";

/**
 * A question the reader parked: the same thread an Ask makes, with the question as its one message and no answer.
 * Nothing reaches the tutor. The provider is only the one chosen now; sending picks the one in use then.
 */
export const parkThread = (body: Record<string, unknown>, book: LibraryBook): PassageThread | string => {
  const provider = isProviderId(body.provider) ? body.provider : "claude";
  const thread = passageThread({ ...body, action: "ask" }, book, provider);
  if (typeof thread === "string") return thread;
  if (thread.kind !== "passage") return "Invalid selection.";
  return { ...thread, parkedAt: thread.createdAt };
};

export const saveParked = async (bookId: BookId, thread: PassageThread, dataDir = getConfig().dataDir): Promise<Thread[]> =>
  (await updateBookState(bookId, (state) => ({ ...state, threads: [...state.threads, thread] }), dataDir)).threads;

/** Removes a parked question. A thread that was sent is a conversation and stays. */
export const discardParked = async (bookId: BookId, id: string, dataDir = getConfig().dataDir): Promise<Thread[]> =>
  (
    await updateBookState(
      bookId,
      (state) => ({
        ...state,
        threads: state.threads.filter((thread) => thread.id !== id || !isParked(thread)),
        activeThreadId: state.activeThreadId === id && state.threads.some((t) => t.id === id && isParked(t)) ? null : state.activeThreadId,
      }),
      dataDir,
    )
  ).threads;
