"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ReaderHandle } from "@/components/reader/types";
import type { BookFormat, BookId } from "@/lib/shared/types";
import { bookHref, takeArrival } from "./arrival";
import { SearchDialog } from "./SearchDialog";

/**
 * The library search on a book's page. A result in this book jumps there; one in another book opens that book
 * at the place. `arrive` jumps to the place this page was opened at by such a result, once the book is ready.
 */
export function useBookSearch(
  book: { id: BookId; format: BookFormat },
  navigate: (move: (reader: ReaderHandle) => unknown) => void,
): { open(): void; arrive(): void; dialog: ReactNode } {
  const router = useRouter();
  const [searching, setSearching] = useState(false);
  const open = useCallback(() => setSearching(true), []);
  const arrive = useCallback(() => {
    const anchor = takeArrival(book.format);
    if (anchor) navigate((reader) => reader.goTo(anchor));
  }, [book.format, navigate]);

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
  return { open, arrive, dialog };
}
