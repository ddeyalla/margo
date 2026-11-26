import { randomUUID } from "node:crypto";
import { anchorItem, LEDGER_SOURCES, topicItem } from "@/lib/shared/ledger";
import { recordEvidence } from "../ledger";
import { parseAnchor } from "../validate";
import { ToolError } from "./schema";
import { BOOK_ID, defineTool, requireBook } from "./tool";
import { ANCHOR_SHAPE } from "./write";

const HELP = ["none", "hint", "shown"] as const;

export const recordEvidenceTool = defineTool({
  name: "record_evidence",
  description:
    "Adds one event to the learner ledger: something the reader met or was checked on outside the app, such as a question you asked them in a study session. Give `outcome` only when they were checked; leave it out when they only read or discussed it. Be honest about `help`: only an answer from memory with no hint counts as strong evidence. Give the passage's `anchor` when there is one, so the event joins the same item as their cards and highlights there. Events are only ever added.",
  effect: "write",
  input: {
    bookId: BOOK_ID,
    source: { type: "string", max: 20, oneOf: LEDGER_SOURCES, description: "What kind of moment it was. A spoken or typed recall check is focus-recall; the reader explaining a passage in their own words is explain-back; a question they asked is ask." },
    topic: { type: "string", max: 240, description: "What it was about, in a short line: the question asked or the fact checked." },
    chapter: { type: "string", max: 500, optional: true, description: "The chapter's title, as the book names it." },
    anchor: { type: "object", optional: true, description: "The passage it is about.", shape: ANCHOR_SHAPE },
    outcome: { type: "number", min: 0, max: 1, optional: true, description: "How well they did, from 0 (missed) to 1 (right). Leave out when nothing was checked." },
    help: { type: "string", max: 10, oneOf: HELP, optional: true, description: "none: answered from memory. hint: needed a hint. shown: picked from options or had seen the answer. Default none." },
    hintLevel: { type: "integer", min: 1, max: 3, optional: true, description: "With help \"hint\": how big the hint was, 1 a nudge to 3 nearly the answer. Default 1." },
    confidence: { type: "integer", min: 0, max: 100, optional: true, description: "How sure they said they were before the answer, 0 to 100, if you asked." },
  },
  run: async ({ bookId, source, topic, chapter, anchor: rawAnchor, outcome, help = "none", hintLevel, confidence }, { now }) => {
    const { book } = await requireBook(bookId);
    const anchor = rawAnchor === undefined ? null : parseAnchor(rawAnchor, book.format);
    if (rawAnchor !== undefined && !anchor) throw new ToolError(`"anchor" is not a place in this ${book.format.toUpperCase()}. Copy one from a search hit or get_book_text.`);
    const [event] = await recordEvidence([
      {
        id: `${book.id}:agent:${randomUUID()}`,
        at: now.toISOString(),
        bookId: book.id,
        item: anchor ? anchorItem(anchor) : topicItem(topic),
        anchor,
        chapter: chapter ?? null,
        source,
        outcome: outcome ?? null,
        unaided: outcome !== undefined && help === "none",
        hintLevel: help === "hint" ? (hintLevel ?? 1) : 0,
        confidence: confidence ?? null,
        topic,
      },
    ]);
    return { recorded: { at: event.at, source: event.source, outcome: event.outcome, daysSince: event.daysSince } };
  },
});
