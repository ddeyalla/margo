"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui";
import { bookHref } from "./arrival";
import { SEARCH_SHORTCUT, SearchDialog } from "./SearchDialog";

/** The library heading's search button, and ⌘K anywhere on the page. A result opens its book at that place. */
export function LibrarySearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.code === "KeyK") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <>
      <Button onClick={() => setOpen(true)} title={`Search the library (${SEARCH_SHORTCUT})`}>
        <Search />
        Search
      </Button>
      {open ? <SearchDialog onClose={() => setOpen(false)} onPick={(book, hit) => router.push(bookHref(book.id, hit.anchor))} /> : null}
    </>
  );
}
