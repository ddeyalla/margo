import { SUGGESTION_STATUSES } from "@/lib/shared/suggestions";
import { listSuggestions, proposeCard } from "../suggestions";
import { BOOK_ID, defineTool, requireBook } from "./tool";
import { PROVIDER_FIELD, requireChecker } from "./verify";
import { ANCHOR_SHAPE } from "./write";

/* How an agent changes the reader's content: by proposing. The reader accepts or rejects each one in the app. */

const proposeCardTool = defineTool({
  name: "propose_card",
  description:
    "Proposes review cards for a passage: one fact the passage states, and one to three questions that each reach that fact a different way, answerable without the book open. Each card is first checked against the quote by a model that answers the question from the quote alone, so the call takes several seconds a card. Cards that pass wait on the reader's Today card, and nothing is added to their cards until they accept. Cards that fail are left out and come back in `failed` with why; when none pass, the status is \"failed\" and the reader is not asked. Fix the card or quote more of the passage, and propose again.",
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
      description: 'One to three cards. Each is a "flip" by default: the reader thinks of the answer, sees it and rates themselves. Give `type: "choice"` with `choices` (2 to 6 options, the right one word for word as the `answer`) to have them pick; give `type: "free"` for a written answer that a grader marks against the passage.',
      item: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
          type: { type: "string", enum: ["flip", "choice", "free"] },
          choices: { type: "array", items: { type: "string" }, maxItems: 6 },
        },
        required: ["question", "answer"],
      },
    },
    provider: PROVIDER_FIELD,
  },
  run: async ({ bookId, provider, ...proposal }, { caller, now }) => {
    const { book } = await requireBook(bookId);
    const suggestion = await proposeCard(book, proposal, caller, await requireChecker(provider), now);
    const { cards, failed = [] } = suggestion.payload;
    return { suggestionId: suggestion.id, status: suggestion.status, verified: cards.length, failed: failed.map(({ question, reason }) => ({ question, reason })) };
  },
});

const listSuggestionsTool = defineTool({
  name: "list_suggestions",
  description: "The changes agents have proposed and where each stands: pending until the reader decides, then accepted or rejected, or failed when none of its cards passed the check against the passage. Check it before proposing, so the reader isn't asked the same thing twice.",
  effect: "read",
  input: { status: { type: "string", max: 20, oneOf: SUGGESTION_STATUSES, optional: true, description: "Only suggestions with this status." } },
  run: async ({ status }) => ({ suggestions: await listSuggestions(status) }),
});

export const SUGGESTION_TOOLS = [proposeCardTool, listSuggestionsTool] as const;
