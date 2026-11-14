import { placeLabel } from "@/lib/shared/place";
import { isSixthReply } from "@/lib/shared/work";
import type { Thread, TutorAction, TypedAction } from "@/lib/shared/types";
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
export const ACTION_MESSAGES: Record<Exclude<TutorAction, TypedAction>, string> = {
  explain: "Explain this passage.",
  deeper: "Go deeper on this passage.",
  work: "Help me work this out.",
};

/** What the reader's message says when they send images with no words. */
export const imageMessage = (count: number) => (count === 1 ? "Explain this image." : "Explain these images.");

const ACTION_REQUESTS: Record<Exclude<TutorAction, "ask">, string> = {
  explain: "Explain this passage.",
  deeper:
    "Go deeper on this passage, but let me try first. Don't explain yet. Ask me one short question about the idea underneath it, one I can attempt from the passage, and stop. When I answer, tell me what I got right and what I missed, then go deeper: the ideas underneath it, how it connects to the wider subject, and what an expert would add. If I say I don't know or ask you to just tell me, explain it straight away.",
  work: [
    "Help me work this passage out. Lead me to the answer; don't give it. These rules hold for the whole thread.",
    "First decide the right answer privately, and never state it. Open with one line naming what we're working out, such as \"We're working out why X holds.\" Then ask me one question I can attempt from the passage, and stop.",
    "Every reply ends with exactly one question: one sentence with one question mark, asking for one thing. A question joined with \"and\" or \"or\" counts as two, and so does a second question anywhere in the reply. Put any context before it as statements. When I reply, judge it in a few words as right, partly right or wrong. If it's partly right or wrong, nudge me at my first mistake: quote the words of mine that go wrong and say what to look at again. Never say what the passage says instead, never write the corrected version, and never say \"it doesn't say X, it says Y\". Never reveal the answer early.",
    "When I send \"Hint 1\" to \"Hint 4\", give exactly that step and no more. Hint 1: name only where to look again, the sentence or paragraph, by its first few words. Don't quote the part that holds the answer, don't explain it and don't add a clue; the question that follows must not name or hint at the idea. Hint 2: say what kind of idea it is, such as a cause, a definition or a trade-off. Hint 3: name the idea. Hint 4: show the worked step. Then ask one question.",
    "When I say \"Just tell me\", or when my message says it's my sixth reply, explain it fully and plainly, then stop leading. After that, act as a normal tutor for the rest of the thread.",
  ].join("\n\n"),
  explainBack: [
    "Check my explanation against the passage.",
    "If it holds, say so in one line, then add at most one thing worth noticing that I left out.",
    "If it doesn't, point to my first mistake only. Quote my words, say what's off, and point me back to the part of the passage that shows it. Don't rewrite my whole explanation and don't list every issue.",
    "Give no grade or score, and no praise padding.",
    "If there was a mistake, end by inviting me to try again, in one short line.",
    "After that, answer my follow-ups as a normal tutor.",
  ].join("\n\n"),
};

/** Added to the reader's sixth reply in a Work it out thread, in the provider's copy only. */
const SIXTH_REPLY_NOTE = "(This is my sixth reply. Explain it fully now.)";

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
  const request =
    thread.action === "ask"
      ? `My question: ${first}`
      : thread.action === "explainBack"
        ? `My explanation, in my own words: ${first}\n\n${ACTION_REQUESTS.explainBack}`
        : ACTION_REQUESTS[thread.action];
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
    const base = index === 0 ? contextMessage(book, thread) : message.content;
    const content = index === thread.messages.length - 1 && isSixthReply(thread) ? `${base}\n\n${SIXTH_REPLY_NOTE}` : base;
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
