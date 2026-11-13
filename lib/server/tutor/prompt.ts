import { placeLabel } from "@/lib/shared/place";
import type { Thread, TutorAction } from "@/lib/shared/types";
import type { TutorImage, TutorMessage, TutorTurn } from "./types";

export const TUTOR_SYSTEM = `You are a patient tutor sitting beside someone who is reading a book. They select a passage, or share an image such as a figure, a screenshot or a photo of their working, and ask you about it. Some questions come with no passage at all.

- Ground every answer in what they gave you first: the passage, and what it means where it sits in the book, or the image, read closely. Then broaden only as far as it helps.
- Connect an image to the book and to where they are reading when you can. If part of an image is unreadable, say which part.
- Give the smallest answer that helps. No preamble, no restating the question, no closing summary or offer of more. They can ask a follow-up.
- Use plain language and short paragraphs. Prefer one concrete example to an abstract explanation.
- When you are not sure of something, say so plainly before you build on it, or build only on what you are sure of.
- Ask at most one question in a reply.
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
    "Go deeper on this passage, but let me try first. Don't explain yet. Ask me one short question about the idea underneath it, one I can attempt from the passage, and stop. When I answer, tell me what I got right and what I missed, then go deeper: the ideas underneath it, how it connects to the wider subject, and what an expert would add. If I say I don't know or ask you to just tell me, explain it straight away.",
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
 * expanded into the full context and each message's images read from `images`,
 * the stored bytes by id. A message sent after an unanswered one joins it, so
 * roles still alternate.
 */
export const buildTurn = (book: BookLabel, thread: Thread, model: string | null, images: ReadonlyMap<string, Buffer>): TutorTurn => ({
  system: TUTOR_SYSTEM,
  messages: thread.messages.reduce<TutorMessage[]>((merged, message, index) => {
    const content = index === 0 ? contextMessage(book, thread) : message.content;
    const attached = (message.attachments ?? []).flatMap((attachment): TutorImage[] => {
      const bytes = images.get(attachment.id);
      return bytes ? [{ mediaType: attachment.mediaType, data: bytes.toString("base64") }] : [];
    });
    const last = merged.at(-1);
    if (last?.role === message.role) {
      last.content += `\n\n${content}`;
      last.images.push(...attached);
    } else {
      merged.push({ role: message.role, content, images: attached });
    }
    return merged;
  }, []),
  sessionId: thread.sessionId,
  model,
});

/** An image as an Anthropic content block, used by the API and by Claude Code's stream-json input. */
export const imageBlock = (image: TutorImage) => ({
  type: "image" as const,
  source: { type: "base64" as const, media_type: image.mediaType, data: image.data },
});

/** A message as transcript text. Each image becomes a numbered marker where it was shared. */
const transcriptEntry = (message: TutorMessage, firstImage: number): string => {
  const markers = message.images.map((_, index) => `[Image ${firstImage + index}]`).join(" ");
  return markers ? `${markers}\n${message.content}` : message.content;
};

/**
 * What a CLI receives: one message of text and images. Resuming its own
 * session, it needs only the new message and its images; the session holds
 * the rest. Otherwise it gets the whole conversation as a transcript with every
 * image in the thread, numbered where it was shared. That also covers a thread
 * that moved here from another provider, so a tutor always sees every image.
 */
export const cliInput = (turn: TutorTurn): { text: string; images: TutorImage[] } => {
  const latest = turn.messages.at(-1);
  if (!latest) return { text: "", images: [] };
  if (turn.sessionId || turn.messages.length === 1) return { text: latest.content, images: latest.images };
  let imageCount = 0;
  const entries = turn.messages.map((message) => {
    const entry = transcriptEntry(message, imageCount + 1);
    imageCount += message.images.length;
    return entry;
  });
  const earlier = turn.messages
    .slice(0, -1)
    .map((message, index) => `${message.role === "user" ? "Reader" : "Tutor"}:\n${entries[index]}`)
    .join("\n\n");
  const lead = imageCount ? "The attached images are numbered in the order they were shared.\n\n" : "";
  return {
    text: `${lead}${earlier}\n\nThe reader's new message:\n${entries.at(-1)}`,
    images: turn.messages.flatMap((message) => message.images),
  };
};
