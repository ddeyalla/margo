import { chapterCounts, ledgerItems, totals, weakest } from "@/lib/shared/ledger";
import { readLedger } from "../ledger";
import { itemForAgent } from "./ledger-query";
import { BOOK_ID, defineTool, requireBookState } from "./tool";

const DEFAULT_WEAKEST = 5;

export const weakestItems = defineTool({
  name: "weakest_items",
  description:
    "What the reader is weakest on in one book, weakest first: what they missed while sure of it, then what they missed, then what has faded or was never proven after a day away, then what they met and never checked. Each has its topic, chapter, an anchor to open the passage, and one line on why. Also gives the book's held, shaky and untested counts by chapter.",
  effect: "read",
  input: {
    bookId: BOOK_ID,
    limit: { type: "integer", min: 1, max: 50, optional: true, description: `How many to return. Default ${DEFAULT_WEAKEST}.` },
  },
  run: async ({ bookId, limit = DEFAULT_WEAKEST }, { now }) => {
    const { book, title } = await requireBookState(bookId);
    const items = ledgerItems((await readLedger()).filter((event) => event.bookId === book.id), now);
    const chapters = chapterCounts(items);
    return { book: { id: book.id, title }, counts: totals(chapters), weakest: weakest(items, limit).map(itemForAgent), chapters };
  },
});
