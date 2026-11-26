import { randomUUID } from "node:crypto";
import { addCards, type NewCards } from "@/lib/shared/cards";
import type { CardSet, LibraryBook } from "@/lib/shared/types";
import { updateBookState } from "../store";
import { mirrorVault } from "../vault";

/**
 * Stores new cards for a passage and, when any were added, rewrites the book's markdown copy. A passage that
 * already has cards gains only the questions it doesn't ask yet, so storing the same cards twice adds them once.
 */
export const storeCards = async (
  book: LibraryBook,
  cards: NewCards,
  { dataDir, notesDir }: { dataDir: string; notesDir: string | null },
  now = new Date(),
): Promise<{ cardSets: CardSet[]; added: number }> => {
  let added = 0;
  const saved = await updateBookState(
    book.id,
    (current) => {
      const result = addCards(current.cardSets, cards, now, randomUUID);
      added = result.count;
      return { ...current, cardSets: result.sets };
    },
    dataDir,
  );
  if (added) await mirrorVault(book, dataDir, notesDir);
  return { cardSets: saved.cardSets, added };
};
