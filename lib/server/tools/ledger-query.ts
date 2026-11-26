import { ledgerItems, type LedgerEvent, type LedgerItem } from "@/lib/shared/ledger";
import { readLedger } from "../ledger";
import { BOOK_ID, defineTool, requireBook } from "./tool";

const DEFAULT_ITEMS = 30;
const DEFAULT_EVENTS = 20;

/** An item as an agent reads it: its state and why, with recall rounded so it isn't mistaken for a measurement. */
export const itemForAgent = (item: LedgerItem) => ({ ...item, recall: item.recall === null ? null : Math.round(item.recall * 100) / 100 });

const matches = (text: string | null, wanted: string | undefined) => !wanted || (text ?? "").toLowerCase().includes(wanted.toLowerCase());

export const queryLedger = defineTool({
  name: "query_ledger",
  description:
    "The learner ledger: evidence of what the reader knows, from card ratings, quiz answers, whiteboard redraws, highlights and questions, across every book. Filter by book, chapter, or words in the topic. Returns each matching item as held (recalled unaided after a day or more away, and not faded since), shaky (checked, but missed, faded, or only right on the same day or with help) or untested (met, never checked), then the latest events. State is worked out from the events at the time of the call.",
  effect: "read",
  input: {
    bookId: { ...BOOK_ID, optional: true, description: "Only this book." },
    chapter: { type: "string", max: 500, optional: true, description: "Only chapters whose title contains these words." },
    topic: { type: "string", max: 200, optional: true, description: "Only items whose topic contains these words." },
    state: { type: "string", max: 10, oneOf: ["held", "shaky", "untested"], optional: true, description: "Only items in this state." },
    limit: { type: "integer", min: 1, max: 200, optional: true, description: `The most items to return. Default ${DEFAULT_ITEMS}.` },
    events: { type: "integer", min: 0, max: 200, optional: true, description: `The most recent events to return. Default ${DEFAULT_EVENTS}.` },
  },
  run: async ({ bookId, chapter, topic, state, limit = DEFAULT_ITEMS, events = DEFAULT_EVENTS }, { now }) => {
    const book = bookId ? (await requireBook(bookId)).book.id : null;
    const wanted = (entry: Pick<LedgerEvent, "bookId" | "chapter" | "topic">) => (!book || entry.bookId === book) && matches(entry.chapter, chapter) && matches(entry.topic, topic);
    const log = await readLedger();
    /* States come from all of an item's events, so the filter is applied to items, not to the events behind them. */
    const items = ledgerItems(log, now).filter((item) => wanted(item) && (!state || item.state === state));
    const kept = new Set(items.map((item) => `${item.bookId}\n${item.item}`));
    const recent = log.filter((event) => kept.has(`${event.bookId}\n${event.item}`));
    const count = (name: LedgerItem["state"]) => items.filter((item) => item.state === name).length;
    return {
      counts: { held: count("held"), shaky: count("shaky"), untested: count("untested") },
      items: items.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)).slice(0, limit).map(itemForAgent),
      totalItems: items.length,
      recentEvents: events ? recent.slice(-events).reverse() : [],
      totalEvents: recent.length,
    };
  },
});
