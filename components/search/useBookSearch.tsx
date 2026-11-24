"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ReaderHandle } from "@/components/reader/types";
import type { BookFormat, BookId } from "@/lib/shared/types";
import { bookHref, takeArrival } from "./arrival";
import { SearchDialog } from "./SearchDialog";

/**
 * The library search on a book's page. A result in this book jumps there; one in another book opens that book
 * at the place. `placed` is told of the reader's places; the first one, which is the book showing its saved
 * place, is when a page opened by such a result jumps to it, so the saved place doesn't land over the jump.
 */
export function useBookSearch(
  book: { id: BookId; format: BookFormat },
  navigate: (move: (reader: ReaderHandle) => unknown) => void,
): { open(): void; placed(): void; dialog: ReactNode } {
  const router = useRouter();
  const [searching, setSearching] = useState(false);
  const open = useCallback(() => setSearching(true), []);
  const arrival = useRef<ReturnType<typeof takeArrival>>(null);
  /* The address loses the place once it is read, so a second run of this effect (Strict Mode) finds nothing and keeps it. */
  useEffect(() => {
    arrival.current = takeArrival(book.format) ?? arrival.current;
  }, [book.format]);
  const placed = useCallback(() => {
    const anchor = arrival.current;
    if (!anchor) return;
    arrival.current = null;
    navigate((reader) => reader.goTo(anchor));
  }, [navigate]);

  const dialog = searching ? (
    <SearchDialog
      currentBookId={book.id}
      onClose={() => setSearching(false)}
      onPick={(picked, hit) => {
        setSearching(false);
        if (picked.id === book.id) navigate((reader) => reader.goTo(hit.anchor));
        else router.push(bookHref(picked.id, hit.anchor));
      }}
    />
  ) : null;
  return { open, placed, dialog };
}
