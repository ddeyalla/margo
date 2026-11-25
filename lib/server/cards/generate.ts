import { readFileSync } from "node:fs";
import path from "node:path";
import { lastRecord, misconceptions } from "@/lib/shared/confidence";
import type { CardSet } from "@/lib/shared/types";
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
const cardSystem = () => (system ??= readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), "lib/server/cards/prompt.md"), "utf8"));

/**
 * The cues the passage already has, one per line. A cue that drew confident wrong answers says so, with what the
 * reader was thinking the last time: that is evidence the question misleads, not that the reader is careless.
 */
const existingCues = (set: CardSet): string =>
  set.cues
    .map((cue) => {
      const wrong = misconceptions(set, cue.id);
      if (!wrong) return `- ${cue.question}`;
      const thinking = lastRecord(set, cue.id)?.thinking;
      return `- ${cue.question}\n  (Answered wrong while sure ${wrong === 1 ? "once" : `${wrong} times`}.${thinking ? ` Last time the reader was thinking: "${thinking}"` : ""})`;
    })
    .join("\n");

export const cardRequest = (book: BookLabel, source: CardSource, existing: CardSet | null): string => {
  const misled = existing?.cues.some((cue) => misconceptions(existing, cue.id) > 0) ?? false;
  return [
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
    existing?.cues.length
      ? `The reader already has these cards on this passage. Add only cards that start somewhere new, for the same fact. If these already cover it, return no cards.\n${existingCues(existing)}\n\n${
          misled
            ? "A card the reader answered wrong while sure is a bad cue, not a bad reader: its wording leads to a wrong answer that feels right. Write one card that asks for the same fact from somewhere that can't be misread that way, even if the others already cover the fact.\n\n"
            : ""
        }Make flashcards for this passage.`
      : "Make flashcards for this passage.",
  ]
    .filter((line) => line !== null)
    .join("\n");
};

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
