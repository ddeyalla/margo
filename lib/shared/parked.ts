import type { PassageThread, Thread } from "./types";

/** A question the reader saved on a passage and has not sent to the tutor. */
export type ParkedThread = PassageThread & { parkedAt: string };

export const isParked = (thread: Thread): thread is ParkedThread => thread.kind === "passage" && typeof thread.parkedAt === "string";

/** The parked questions, newest first. */
export const parkedFirst = (threads: Thread[]): ParkedThread[] =>
  threads.filter(isParked).sort((a, b) => b.parkedAt.localeCompare(a.parkedAt));
