import { readFileSync } from "node:fs";
import path from "node:path";
import type { Cue } from "@/lib/shared/types";
import type { BookLabel } from "../tutor/prompt";
import type { Provider, TutorMessage } from "../tutor/types";
import { parseCardReply, type CardReply } from "./reply";

/** The passage cards are made from, already validated and trimmed. */
export interface CardSource {
  quote: string;
  before: string;
  after: string;
  chapterTitle: string | null;
}

/* Read once per server start. Next runs the server from the project folder. */
let system: string | null = null;
const cardSystem = () => (system ??= readFileSync(path.join(process.cwd(), "lib/server/cards/prompt.md"), "utf8"));

export const cardRequest = (book: BookLabel, source: CardSource, existing: Cue[]): string =>
  [
    `Book: ${book.title}${book.author ? `, by ${book.author}` : ""}`,
    source.chapterTitle ? `Where: ${source.chapterTitle}` : null,
    "",
    "Text just before the selection:",
    `<before>\n${source.before || "(start of the section)"}\n</before>`,
    "",
    "The selected passage:",
    `<selection>\n${source.quote}\n</selection>`,
    "",
    "Text just after the selection:",
    `<after>\n${source.after || "(end of the section)"}\n</after>`,
    "",
    existing.length
      ? `The reader already has these cards on this passage. Add only cards that start somewhere new, for the same fact. If these already cover it, return no cards.\n${existing.map((cue) => `- ${cue.question}`).join("\n")}\n\nMake flashcards for this passage.`
      : "Make flashcards for this passage.",
  ]
    .filter((line) => line !== null)
    .join("\n");

const collect = async (provider: Provider, messages: TutorMessage[], model: string | null, signal: AbortSignal): Promise<string> => {
  let text = "";
  for await (const event of provider.run({ system: cardSystem(), messages, sessionId: null, model }, signal)) {
    if (event.type === "text") text += event.delta;
    else if (event.type === "error") throw new Error(event.message);
  }
  return text;
};

/**
 * Asks the tutor for cards. A reply that can't be read goes back once with the
 * reason, in the same conversation, rather than starting over.
 */
export const generateCards = async (
  provider: Provider,
  request: string,
  model: string | null,
  signal: AbortSignal,
): Promise<CardReply> => {
  const messages: TutorMessage[] = [{ role: "user", content: request, images: [] }];
  const first = await collect(provider, messages, model, signal);
  const parsed = parseCardReply(first);
  if (typeof parsed !== "string") return parsed;
  const repair: TutorMessage[] = [
    ...messages,
    { role: "assistant", content: first, images: [] },
    { role: "user", content: `That reply couldn't be used. ${parsed} Reply again with exactly one JSON object in the format you were given.`, images: [] },
  ];
  const second = parseCardReply(await collect(provider, repair, model, signal));
  if (typeof second === "string") throw new Error(`The tutor's cards couldn't be read. ${second}`);
  return second;
};
