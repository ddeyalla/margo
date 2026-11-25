"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { BookOpen, FileText, Highlighter, Layers, Search, StickyNote } from "lucide-react";
import { Kbd, Spinner } from "@/components/ui";
import { ModalDialog } from "@/components/ui/dialog";
import type { SearchBook, SearchHit, SearchKind, SearchResults } from "@/lib/shared/search";
import type { BookId } from "@/lib/shared/types";

export const SEARCH_SHORTCUT = "⌘K";

/** How long typing must pause before a search goes out, and how often an unfinished index is asked about again. */
const DEBOUNCE_MS = 120;
const POLL_MS = 1500;

const KIND_ICONS: Record<SearchKind, ReactNode> = {
  text: <FileText />,
  highlight: <Highlighter />,
  note: <StickyNote />,
  card: <Layers />,
};
const KIND_LABELS: Record<SearchKind, string> = { text: "Book text", highlight: "Highlight", note: "Note", card: "Card" };

interface Row {
  book: SearchBook;
  hit: SearchHit;
}

/** The snippet with its matching words marked. */
function Snippet({ text, marks }: { text: string; marks: SearchHit["marks"] }) {
  const pieces: ReactNode[] = [];
  let at = 0;
  marks.forEach(([start, end], index) => {
    if (start > at) pieces.push(text.slice(at, start));
    pieces.push(
      <mark key={index} className="rounded-xs bg-highlight text-paper">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  });
  pieces.push(text.slice(at));
  return <>{pieces}</>;
}

const indexingLine = ({ ready, total, failed }: SearchResults["indexing"]) => {
  const left = total - ready - failed;
  if (left > 0) return `Reading ${left} of ${total} ${total === 1 ? "book" : "books"} for search. Their highlights, notes and cards are searched already.`;
  if (failed > 0) return `${failed} ${failed === 1 ? "book's" : "books'"} text couldn't be read; only what you saved there is searched.`;
  return null;
};

/**
 * One box over the whole library: every book's text, and every highlight, note and card. Results come
 * grouped by book, then chapter. Arrow keys move through them, Enter jumps to the place and closes the box.
 */
export function SearchDialog({ currentBookId, onClose, onPick }: { currentBookId?: BookId; onClose(): void; onPick(book: SearchBook, hit: SearchHit): void }) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  /* The results with the query they answer, so a slow answer is shown for what it is. */
  const [answer, setAnswer] = useState<{ query: string; results: SearchResults } | null>(null);
  const results = answer?.results ?? null;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  /* Bumped to ask again with the same query while books are still being read. */
  const [tick, setTick] = useState(0);
  /* The query the results answer, so a slow answer to an old query never replaces a newer one. */
  const answered = useRef<string | null>(null);

  const rows = useMemo<Row[]>(
    () => results?.books.flatMap((book) => book.chapters.flatMap((chapter) => chapter.hits.map((hit) => ({ book, hit })))) ?? [],
    [results],
  );

  const indexing = results?.indexing;
  const unfinished = !!indexing && indexing.ready + indexing.failed < indexing.total;

  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { cache: "no-store", signal: controller.signal });
        const body = (await response.json()) as SearchResults | { error: string };
        if ("error" in body) throw new Error(body.error);
        if (answered.current !== query) setActive(0);
        answered.current = query;
        setAnswer({ query, results: body });
        setError(null);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Search failed.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    /* The first look goes at once, so books start indexing as the box opens; later ones wait for a pause. */
    const timer = setTimeout(run, answered.current === null ? 0 : DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, tick]);

  /* While books are still being read, ask again now and then, so their text joins the results. */
  useEffect(() => {
    if (!unfinished) return;
    const timer = setTimeout(() => setTick((current) => current + 1), POLL_MS);
    return () => clearTimeout(timer);
  }, [unfinished, results]);

  const pick = (row: Row | undefined) => {
    if (row) onPick(row.book, row.hit);
  };

  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  const shown = query.trim();
  let index = -1;

  return (
    <ModalDialog
      aria-label="Search the library"
      onClose={onClose}
      className="mx-auto mt-[12vh] mb-auto flex max-h-[70vh] w-[min(640px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl bg-panel-raised p-0 text-paper shadow-dialog outline-none backdrop:bg-scrim"
    >
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-4">
        <Search aria-hidden className="size-4 shrink-0 text-dim" />
        <input
          ref={inputRef}
          autoFocus
          role="combobox"
          aria-expanded={rows.length > 0}
          aria-controls={listId}
          aria-activedescendant={rows.length ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (rows.length) setActive((current) => (current + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
            } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              pick(rows[active]);
            }
          }}
          placeholder="Search every book, highlight, note and card"
          className="h-12 min-w-0 flex-1 bg-transparent text-callout text-paper outline-none placeholder:text-dim"
        />
        {loading ? <Spinner className="text-dim" /> : <Kbd>esc</Kbd>}
      </div>

      {indexing && indexingLine(indexing) ? (
        <p className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2 text-label text-dim">
          {unfinished ? <Spinner /> : null}
          {indexingLine(indexing)}
        </p>
      ) : null}

      <div id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {error ? (
          <p role="alert" className="px-4 py-6 text-center text-label text-danger">
            {error}
          </p>
        ) : !shown ? (
          <p className="px-4 py-6 text-center text-label text-dim">Type a word or phrase you remember. Enter jumps to it.</p>
        ) : answer?.query.trim() === shown && !rows.length && !loading ? (
          <p className="px-4 py-6 text-center text-label text-dim">Nothing matches “{shown}”.</p>
        ) : (
          results?.books.map((book) => (
            <section key={book.id} aria-label={book.title} className="pb-1">
              <h3 className="sticky top-0 z-10 flex items-center gap-2 bg-panel-raised px-4 pt-2 pb-1 text-label font-semibold text-paper">
                <BookOpen aria-hidden className="size-3.5 shrink-0 text-dim" />
                <span className="truncate">{book.title}</span>
                {book.id === currentBookId ? <span className="shrink-0 font-normal text-dim">this book</span> : null}
              </h3>
              {book.chapters.map((chapter, c) => (
                <div key={`${chapter.title}-${c}`} role="group" aria-label={chapter.title ?? "No chapter"}>
                  {chapter.title ? <p className="truncate px-4 pt-1 pl-[34px] text-caption text-dim">{chapter.title}</p> : null}
                  {chapter.hits.map((hit) => {
                    index += 1;
                    const row = index;
                    return (
                      <div
                        key={row}
                        id={`${listId}-${row}`}
                        role="option"
                        aria-selected={row === active}
                        onMouseMove={() => setActive(row)}
                        onClick={() => pick({ book, hit })}
                        className={clsx(
                          "mx-1.5 flex cursor-default items-start gap-2 rounded-lg px-2.5 py-1.5",
                          row === active ? "bg-tint-strong" : "",
                        )}
                      >
                        <span title={KIND_LABELS[hit.kind]} className="mt-[3px] flex shrink-0 text-dim [&>svg]:size-3.5">
                          {KIND_ICONS[hit.kind]}
                        </span>
                        <span className="sr-only">{KIND_LABELS[hit.kind]}: </span>
                        <span className="line-clamp-2 min-w-0 text-body text-fog">
                          <Snippet text={hit.snippet} marks={hit.marks} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </ModalDialog>
  );
}
