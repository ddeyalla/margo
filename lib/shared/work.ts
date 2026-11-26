import type { Thread } from "./types";

/** The reader's reply that ends the leading, sent by the Just tell me button. */
export const JUST_TELL_ME = "Just tell me.";
/** After this many replies in a Work it out thread, the tutor stops leading and explains. */
export const WORK_REPLY_LIMIT = 6;
export const MAX_HINTS = 4;

export const isJustTellMe = (content: string) => /^just tell me\b/i.test(content.trim());

/** The reader's messages after the first, which only opened the thread. */
export const replies = (thread: Thread) => thread.messages.slice(1).filter((message) => message.role === "user");

/**
 * Where a Work it out thread stands: whether the tutor is still leading, and
 * how many hints the reader has asked for. Leading ends on "Just tell me" or
 * at the sixth reply. Any other thread is never leading.
 */
export const workState = (thread: Thread): { leading: boolean; hintsUsed: number } => {
  if (thread.kind !== "passage" || thread.action !== "work") return { leading: false, hintsUsed: 0 };
  const own = replies(thread);
  return {
    leading: own.length < WORK_REPLY_LIMIT && !own.some((message) => isJustTellMe(message.content)),
    hintsUsed: own.filter((message) => message.content.startsWith("Hint ")).length,
  };
};

/** True when the thread's newest message is the reader's sixth reply and they never asked to be told. */
export const isSixthReply = (thread: Thread): boolean => {
  if (thread.kind !== "passage" || thread.action !== "work" || thread.messages.at(-1)?.role !== "user") return false;
  const own = replies(thread);
  return own.length === WORK_REPLY_LIMIT && !own.slice(0, -1).some((message) => isJustTellMe(message.content));
};
