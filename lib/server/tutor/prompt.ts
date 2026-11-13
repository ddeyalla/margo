import type { Thread, TutorAction } from "@/lib/shared/types";
import type { TutorMessage, TutorTurn } from "./types";

export const TUTOR_SYSTEM = `You are a patient tutor sitting beside someone who is reading a book. They select a passage and ask you about it.

- Ground every answer in the passage first: what it says, and what it means where it sits in the book. Then broaden only as far as it helps.
- Be concise. Use plain language and short paragraphs. Prefer one concrete example to an abstract explanation.
- When you go beyond what the book says, say so plainly, for example "Beyond the book: ...".
- If the passage is ambiguous or the question is unclear, say what you are assuming.
- Write in Markdown. Use a list or a small table only when it makes the answer clearer.`;

/** What the reader's message says in the chat for each toolbar action. */
export const ACTION_MESSAGES: Record<Exclude<TutorAction, "ask">, string> = {
  explain: "Explain this passage.",
  deeper: "Go deeper on this passage.",
};

const ACTION_REQUESTS: Record<Exclude<TutorAction, "ask">, string> = {
  explain: "Explain this passage.",
  deeper:
    "Go deeper on this passage: the ideas underneath it, how it connects to the wider subject, and what an expert would add.",
};

export interface BookLabel {
  title: string;
  author: string | null;
}

/** The first user turn: the book, where the passage sits, the passage with its surroundings, and the request. */
export const contextMessage = (book: BookLabel, thread: Thread): string => {
  const request = thread.action === "ask" ? `My question: ${thread.messages[0]?.content ?? ""}` : ACTION_REQUESTS[thread.action];
  return [
    `Book: ${book.title}${book.author ? `, by ${book.author}` : ""}`,
    thread.chapterTitle ? `Where: ${thread.chapterTitle}` : null,
    "",
    "Text just before the selection:",
    `<before>\n${thread.before || "(start of the section)"}\n</before>`,
    "",
    "The selected passage:",
    `<selection>\n${thread.quote}\n</selection>`,
    "",
    "Text just after the selection:",
    `<after>\n${thread.after || "(end of the section)"}\n</after>`,
    "",
    request,
  ]
    .filter((line) => line !== null)
    .join("\n");
};

/** The provider-facing conversation: the stored thread, with its first message expanded into the full context. */
export const buildTurn = (book: BookLabel, thread: Thread, model: string | null): TutorTurn => ({
  system: TUTOR_SYSTEM,
  messages: thread.messages.map((message, index) => ({
    role: message.role,
    content: index === 0 ? contextMessage(book, thread) : message.content,
  })),
  sessionId: thread.sessionId,
  model,
});

const transcript = (messages: TutorMessage[]): string =>
  messages.map((message) => `${message.role === "user" ? "Reader" : "Tutor"}:\n${message.content}`).join("\n\n");

/**
 * What a CLI receives as its prompt. Resuming its own session, it needs only
 * the new message. Otherwise it gets the whole conversation, which also covers
 * a thread that moved here from another provider.
 */
export const cliPrompt = (turn: TutorTurn): string => {
  const latest = turn.messages.at(-1)?.content ?? "";
  if (turn.sessionId || turn.messages.length === 1) return latest;
  return `${transcript(turn.messages.slice(0, -1))}\n\nThe reader's new message:\n${latest}`;
};
