import { SUGGESTION_STATUSES } from "@/lib/shared/suggestions";
import { listSuggestions, proposeCard } from "../suggestions";
import { BOOK_ID, defineTool, requireBook } from "./tool";
import { ANCHOR_SHAPE } from "./write";

/* How an agent changes the reader's content: by proposing. The reader accepts or rejects each one in the app. */

const proposeCardTool = defineTool({
  name: "propose_card",
  description:
    "Proposes review cards for a passage: one fact the passage states, and one to three questions that each reach that fact a different way, answerable without the book open. The reader sees the proposal on their Today card and accepts or rejects it; nothing is added to their cards until they accept.",
  effect: "propose",
  input: {
    bookId: BOOK_ID,
    anchor: { type: "object", description: ANCHOR_SHAPE.description, shape: {} },
    quote: { type: "string", max: 12_000, description: "The passage, word for word from the book." },
    chapterTitle: { type: "string", max: 500, optional: true, description: "The chapter the passage is in." },
    fact: { type: "string", max: 2_000, description: "The one fact the cards recall, as a sentence." },
    cards: {
      type: "list",
      max: 3,
      description: "One to three cards.",
      item: { type: "object", properties: { question: { type: "string" }, answer: { type: "string" } }, required: ["question", "answer"] },
    },
  },
  run: async ({ bookId, ...proposal }, { caller, now }) => {
    const suggestion = await proposeCard((await requireBook(bookId)).book, proposal, caller, now);
    return { suggestionId: suggestion.id, status: suggestion.status };
  },
});

const listSuggestionsTool = defineTool({
  name: "list_suggestions",
  description: "The changes agents have proposed and where each stands: pending until the reader decides, then accepted or rejected. Check it before proposing, so the reader isn't asked the same thing twice.",
  effect: "read",
  input: { status: { type: "string", max: 20, oneOf: SUGGESTION_STATUSES, optional: true, description: "Only suggestions with this status." } },
  run: async ({ status }) => ({ suggestions: await listSuggestions(status) }),
});

export const SUGGESTION_TOOLS = [proposeCardTool, listSuggestionsTool] as const;
