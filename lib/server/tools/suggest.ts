import { studyDay } from "@/lib/shared/schedule";
import { SUGGESTION_STATUSES, type PlanExercise, type PlanItem, type PlanQuestion } from "@/lib/shared/suggestions";
import type { LibraryBook } from "@/lib/shared/types";
import { listSuggestions, proposeCard, proposePlan } from "../suggestions";
import { isObject, parseAnchor, shortText } from "../validate";
import { ToolError } from "./schema";
import { BOOK_ID, defineTool, requireBook, requireBookState } from "./tool";
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
      description: "One to three cards.",
      item: { type: "object", properties: { question: { type: "string" }, answer: { type: "string" } }, required: ["question", "answer"] },
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
  description: "The changes agents have proposed (review cards, and prepared session plans) and where each stands: pending until the reader decides, then accepted or rejected, or failed when none of its cards passed the check against the passage. Check it before proposing, so the reader isn't asked the same thing twice.",
  effect: "read",
  input: { status: { type: "string", max: 20, oneOf: SUGGESTION_STATUSES, optional: true, description: "Only suggestions with this status." } },
  run: async ({ status }) => ({ suggestions: await listSuggestions(status) }),
});

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const tomorrow = (now: Date) => studyDay(new Date(now.getTime() + 86_400_000));

/** Looks each book up once for a plan, so a plan naming twenty items in one book reads its state once. */
const planBooks = () => {
  const found = new Map<string, Promise<{ book: LibraryBook; title: string }>>();
  return (id: unknown) => {
    if (typeof id !== "string") throw new ToolError('Every plan entry needs a "bookId".');
    if (!found.has(id)) found.set(id, requireBookState(id).then(({ book, title }) => ({ book, title })));
    return found.get(id)!;
  };
};

const text = (value: unknown, name: string, max: number): string => {
  const out = shortText(value, max);
  if (!out) throw new ToolError(`Every plan entry needs "${name}", as text of at most ${max} characters.`);
  return out;
};

const proposeSessionPlanTool = defineTool({
  name: "propose_session_plan",
  description:
    "Prepares the reader's next session as one suggestion on their Today card: items to retest, one or two exercises tied to where they are in a book, and open questions. It is advice: the reader reads it and taps Got it or Dismiss, and nothing in any book changes. New review cards are not in it; propose those with propose_card. There is one plan a day: preparing again for the same day replaces the plan still waiting. Every bookId must be one from list_library, and every anchor a place copied from search_library, get_book_text or the ledger tools (it is checked for shape, not against the text); write an exercise's prompt only after verify_item has checked it against its passage.",
  effect: "propose",
  input: {
    forDay: { type: "string", max: 10, optional: true, description: "The study day it is for, YYYY-MM-DD. Default tomorrow." },
    note: { type: "string", max: 600, optional: true, description: "One or two plain sentences on why this plan, in neutral words. No praise, no profile of the reader." },
    retest: {
      type: "list",
      max: 8,
      optional: true,
      description: "Shaky and untested items to check again, from weakest_items or query_ledger.",
      item: { type: "object", properties: { bookId: { type: "string" }, topic: { type: "string" }, chapter: { type: "string" }, anchor: { type: "object" }, why: { type: "string", description: "One line, from the ledger: missed, faded, or never checked." } }, required: ["bookId", "topic", "why"] },
    },
    exercises: {
      type: "list",
      max: 2,
      optional: true,
      description: "One or two exercises tied to the passage the reader is at.",
      item: { type: "object", properties: { bookId: { type: "string" }, topic: { type: "string" }, chapter: { type: "string" }, anchor: { type: "object" }, prompt: { type: "string", description: "What the reader is asked to do or answer, checked with verify_item." }, why: { type: "string" } }, required: ["bookId", "topic", "anchor", "prompt", "why"] },
    },
    questions: {
      type: "list",
      max: 5,
      optional: true,
      description: "Open questions to resolve: parked questions and unanswered threads.",
      item: { type: "object", properties: { bookId: { type: "string" }, question: { type: "string" }, threadId: { type: "string" } }, required: ["bookId", "question"] },
    },
  },
  run: async ({ forDay, note, retest = [], exercises = [], questions = [] }, { caller, now }) => {
    if (forDay !== undefined && (!DAY.test(forDay) || Number.isNaN(Date.parse(forDay)))) throw new ToolError('"forDay" must be a date like 2026-12-01.');
    if (forDay !== undefined && forDay < studyDay(now)) throw new ToolError(`"forDay" is a day that has passed. Today's study day is ${studyDay(now)}.`);
    if (!retest.length && !exercises.length && !questions.length) throw new ToolError("A plan needs at least one item to retest, an exercise or an open question.");
    const books = planBooks();
    const item = async (raw: unknown): Promise<PlanItem> => {
      if (!isObject(raw)) throw new ToolError("Each plan entry must be an object.");
      const { book, title } = await books(raw.bookId);
      const anchor = raw.anchor === undefined ? null : parseAnchor(raw.anchor, book.format);
      if (raw.anchor !== undefined && !anchor) throw new ToolError(`An "anchor" is not a place in "${title}". Copy one from a search hit, get_book_text or the ledger tools.`);
      return { bookId: book.id, bookTitle: title, topic: text(raw.topic, "topic", 240), chapter: shortText(raw.chapter, 500), anchor, why: text(raw.why, "why", 300) };
    };
    const payload = {
      forDay: forDay ?? tomorrow(now),
      note: note ?? null,
      retest: await Promise.all(retest.map(item)),
      exercises: await Promise.all(
        exercises.map(async (raw): Promise<PlanExercise> => {
          const base = await item(raw);
          if (!base.anchor) throw new ToolError("An exercise must be tied to a passage: give its anchor.");
          return { ...base, anchor: base.anchor, prompt: text((raw as Record<string, unknown>).prompt, "prompt", 1_000) };
        }),
      ),
      questions: await Promise.all(
        questions.map(async (raw): Promise<PlanQuestion> => {
          if (!isObject(raw)) throw new ToolError("Each plan entry must be an object.");
          const { book, title } = await books(raw.bookId);
          return { bookId: book.id, bookTitle: title, question: text(raw.question, "question", 600), threadId: shortText(raw.threadId, 80) };
        }),
      ),
    };
    const suggestion = await proposePlan(payload, caller, now);
    return { suggestionId: suggestion.id, status: suggestion.status, forDay: payload.forDay, retest: payload.retest.length, exercises: payload.exercises.length, questions: payload.questions.length };
  },
});

export const SUGGESTION_TOOLS = [proposeCardTool, proposeSessionPlanTool, listSuggestionsTool] as const;
