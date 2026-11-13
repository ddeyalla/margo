import Link from "next/link";
import type { BookFormat, BookId } from "@/lib/shared/types";

export interface ShelfBook {
  id: BookId;
  format: BookFormat;
  title: string;
  author: string | null;
  sizeBytes: number;
  /** Reading progress from 0 to 1, or null when the book was never opened. */
  progress: number | null;
}

export interface Shelf {
  folder: string;
  books: ShelfBook[];
}

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function BookCard({ book }: { book: ShelfBook }) {
  const percent = book.progress === null ? null : Math.round(book.progress * 100);
  return (
    <Link
      href={`/book/${book.id}`}
      className="group relative flex min-h-[132px] flex-col gap-2 overflow-hidden rounded-lg bg-panel px-4 pb-4 pt-3.5 outline-none transition-colors duration-[var(--duration-fast)] hover:bg-panel-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <div className="flex items-center gap-2 text-label text-dim tabular-nums">
        <span>{book.format === "epub" ? "EPUB" : "PDF"}</span>
        <span aria-hidden className="size-0.5 rounded-full bg-dim/60" />
        <span>{formatSize(book.sizeBytes)}</span>
        {percent !== null ? <span className="ml-auto text-fog">{percent}%</span> : null}
      </div>
      <h3 className="line-clamp-3 font-reading text-[15px] leading-[1.4] text-paper">{book.title}</h3>
      {book.author ? <p className="mt-auto truncate text-label text-fog">{book.author}</p> : null}
      {percent !== null ? (
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-white/[0.04]">
          <span className="block h-full bg-paper/50" style={{ width: `${Math.max(2, percent)}%` }} />
        </span>
      ) : null}
    </Link>
  );
}

function Grid({ books }: { books: ShelfBook[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2.5">
      {books.map((book) => (
        <BookCard key={book.id} book={book} />
      ))}
    </div>
  );
}

export function BookList({ shelves, recent }: { shelves: Shelf[]; recent: ShelfBook[] }) {
  return (
    <div className="flex flex-col gap-10">
      {recent.length ? (
        <section aria-labelledby="recent" className="flex flex-col gap-3">
          <h2 id="recent" className="text-title text-paper">
            Continue reading
          </h2>
          <Grid books={recent} />
        </section>
      ) : null}
      {shelves.map((shelf) => (
        <section key={shelf.folder} aria-label={shelf.folder} className="flex flex-col gap-3">
          <h2 className="flex items-baseline gap-2 text-title text-paper">
            {shelf.folder || "Unsorted"}
            <span className="text-label font-normal text-dim tabular-nums">{shelf.books.length}</span>
          </h2>
          <Grid books={shelf.books} />
        </section>
      ))}
    </div>
  );
}
