import type { ChatMessage, Thread, TurnUsage } from "@/lib/shared/types";
import { contextMessage, type BookLabel } from "./prompt";
import type { Provider, TutorTurn } from "./types";

/**
 * Past this many tokens of what a turn would send, its oldest turns are folded into a summary. It is where the
 * API's own compaction starts by default: well inside any current window, and before a long thread's every
 * question costs much.
 */
export const COMPACT_AT = 150_000;

/** The newest messages always go as written: about three exchanges. */
const KEEP_RECENT = 6;

/** About what one image costs a model, in tokens. */
const IMAGE_TOKENS = 1_600;

/**
 * A rough size of what a turn sends, in tokens, at four characters each. It only decides when to compact and is
 * never shown. A resumed CLI session is sent only the newest message; the session holds the rest and the CLI
 * compacts it itself.
 */
export const sentTokens = (turn: TutorTurn): number => {
  const sent = turn.sessionId ? turn.messages.slice(-1) : turn.messages;
  const characters = (turn.sessionId ? 0 : turn.system.length) + sent.reduce((sum, message) => sum + message.content.length, 0);
  return Math.ceil(characters / 4) + sent.reduce((sum, message) => sum + message.images.length, 0) * IMAGE_TOKENS;
};

/**
 * Where a new summary would stop: the reader's message that starts the newest few. The first message always goes
 * as written, since it carries the passage. null when that point is no later than the summary's, so there is
 * nothing new to fold.
 */
export const foldPoint = (thread: Thread): number | null => {
  let keepFrom = thread.messages.length - KEEP_RECENT;
  while (keepFrom > 1 && thread.messages[keepFrom]?.role !== "user") keepFrom -= 1;
  return keepFrom > (thread.compaction?.keepFrom ?? 1) ? keepFrom : null;
};

export const COMPACT_SYSTEM = `You keep the notes for a tutoring conversation about a book, so the tutor can carry on without the full history. Write the summary the tutor will read in place of the turns you are given.

- Keep where the reader is in the book, and which passage or idea the conversation is about.
- Keep every question still open, and anything either of them said they would come back to.
- Keep the reader's own words, quoted, where they explained something, got something wrong, or said what they find hard.
- Keep what the reader has shown they understand and what they don't yet.
- If the tutor is leading the reader to an answer without giving it, say how far they have got, and leave the answer out.
- Leave out greetings, repetition, and anything settled that nothing later depends on.

Write short plain notes in the order things happened. No preamble.`;

const transcriptLine = (message: ChatMessage): string => {
  const images = message.attachments?.length ? `[The reader shared ${message.attachments.length === 1 ? "an image" : `${message.attachments.length} images`}.]\n` : "";
  return `${message.role === "user" ? "Reader" : "Tutor"}:\n${images}${message.content}`;
};

/** What the summarizer is asked: the passage, the summary so far, and the turns to fold in, up to `keepFrom`. */
export const summaryRequest = (book: BookLabel, thread: Thread, keepFrom: number): string => {
  const previous = thread.compaction;
  const turns = thread.messages.slice(previous?.keepFrom ?? 1, keepFrom).map(transcriptLine).join("\n\n");
  return [
    `The passage and the reader's first message:\n<start>\n${contextMessage(book, thread)}\n</start>`,
    previous ? `The summary so far:\n<summary>\n${previous.summary}\n</summary>` : null,
    `The turns to fold in:\n<turns>\n${turns}\n</turns>`,
    previous ? "Write the new summary. It replaces the one so far, so carry over what still matters from it." : "Write the summary.",
  ]
    .filter((part) => part !== null)
    .join("\n\n");
};

/**
 * Asks the thread's tutor for a summary up to `keepFrom`, on a session of its own. null when it fails or writes
 * nothing; the turn then goes ahead unsummarized.
 */
export const writeSummary = async (
  provider: Provider,
  book: BookLabel,
  thread: Thread,
  keepFrom: number,
  model: string | null,
  signal: AbortSignal,
): Promise<{ summary: string; usage: TurnUsage | null } | null> => {
  const turn: TutorTurn = { system: COMPACT_SYSTEM, messages: [{ role: "user", content: summaryRequest(book, thread, keepFrom), images: [] }], sessionId: null, model };
  let summary = "";
  let usage: TurnUsage | null = null;
  try {
    for await (const event of provider.run(turn, signal)) {
      if (event.type === "text") summary += event.delta;
      else if (event.type === "usage") usage = event.usage;
      else if (event.type === "error") return null;
    }
  } catch {
    return null;
  }
  summary = summary.trim();
  return summary && !signal.aborted ? { summary, usage } : null;
};
