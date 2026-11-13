import { placeLabel } from "@/lib/shared/place";
import type { Thread, TutorAction } from "@/lib/shared/types";
import type { TutorMessage, TutorTurn } from "./types";

export const TUTOR_SYSTEM = `You are a patient tutor sitting beside someone who is reading a book. They select a passage, or share an image such as a figure, a screenshot or a photo of their working, and ask you about it. Some questions come with no passage at all.

- Ground every answer in what they gave you first: the passage, and what it means where it sits in the book, or the image, read closely. Then broaden only as far as it helps.
- Connect an image to the book and to where they are reading when you can. If part of an image is unreadable, say which part.
- Be concise. Use plain language and short paragraphs. Prefer one concrete example to an abstract explanation.
- When you go beyond what the book says, say so plainly, for example "Beyond the book: ...".
- If the passage or image is ambiguous or the question is unclear, say what you are assuming.
- Write in Markdown. Use a list or a small table only when it makes the answer clearer.`;

/** What the reader's message says in the chat for each toolbar action. */
export const ACTION_MESSAGES: Record<Exclude<TutorAction, "ask">, string> = {
  explain: "Explain this passage.",
  deeper: "Go deeper on this passage.",
};

/** What the reader's message says when they send images with no words. */
export const imageMessage = (count: number) => (count === 1 ? "Explain this image." : "Explain these images.");

const ACTION_REQUESTS: Record<Exclude<TutorAction, "ask">, string> = {
  explain: "Explain this passage.",
  deeper:
    "Go deeper on this passage: the ideas underneath it, how it connects to the wider subject, and what an expert would add.",
};

export interface BookLabel {
  title: string;
  author: string | null;
}

/**
 * The first user turn. For a passage: the book, where it sits, the passage
 * with its surroundings, and the request. For a question with no passage: the
 * book, where the reader is, and their message.
 */
export const contextMessage = (book: BookLabel, thread: Thread): string => {
  const where = thread.anchor && placeLabel(thread.chapterTitle, thread.anchor);
  const heading = `Book: ${book.title}${book.author ? `, by ${book.author}` : ""}`;
  const first = thread.messages[0]?.content ?? "";
  if (thread.kind === "general") {
    return [heading, where ? `Where I am reading: ${where}` : null, "", "I have not selected a passage.", "", first]
      .filter((line) => line !== null)
      .join("\n");
  }
  const request = thread.action === "ask" ? `My question: ${first}` : ACTION_REQUESTS[thread.action];
  return [
    heading,
    where ? `Where: ${where}` : null,
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

/**
 * The provider-facing conversation: the stored thread, with its first message
 * expanded into the full context. A message sent after an unanswered one joins
 * it, so roles still alternate.
 */
export const buildTurn = (book: BookLabel, thread: Thread, model: string | null): TutorTurn => ({
  system: TUTOR_SYSTEM,
  messages: thread.messages.reduce<TutorMessage[]>((merged, message, index) => {
    const content = index === 0 ? contextMessage(book, thread) : message.content;
    const last = merged.at(-1);
    if (last?.role === message.role) last.content += `\n\n${content}`;
    else merged.push({ role: message.role, content });
    return merged;
  }, []),
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
