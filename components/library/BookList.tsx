import Link from "next/link";
import type { BookFormat, BookId } from "@/lib/shared/types";
import { CoverImage } from "./CoverImage";

export interface ShelfBook {
  id: BookId;
  format: BookFormat;
  title: string;
  author: string | null;
  sizeBytes: number;
  /** Reading progress from 0 to 1, or null when the book was never opened. */
  progress: number | null;
  /** The cover image's URL. It changes when the book file does. */
  cover: string;
}

export interface Shelf {
  folder: string;
  books: ShelfBook[];
}

/** Read this far and the book counts as finished; the last pages are often notes and an index. */
const FINISHED = 0.99;

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** A muted hue of its own for each book, so a shelf of books without covers isn't one flat colour. */
const toneOf = (id: BookId) => `oklch(0.3 0.04 ${parseInt(id.slice(0, 4), 16) % 360})`;

/** The book's cover over a plain panel with its title and author, which shows when the book has no cover. */
function Cover({ book }: { book: ShelfBook }) {
  return (
    <div className="relative aspect-[2/3] overflow-hidden rounded-[5px] shadow-[0_10px_28px_-14px_rgba(0,0,0,0.9)] transition-transform duration-[var(--duration-base)] ease-out group-hover:-translate-y-0.5">
      <div aria-hidden className="absolute inset-0 flex flex-col p-3.5" style={{ backgroundColor: toneOf(book.id) }}>
        <span className="h-px w-6 bg-white/25" />
        <p className="mt-3 line-clamp-6 font-reading text-[15px] leading-[1.25] text-white/90">{book.title}</p>
        {book.author ? <p className="mt-auto line-clamp-2 text-[11px] leading-snug text-white/60">{book.author}</p> : null}
      </div>
      <CoverImage src={book.cover} />
      <span aria-hidden className="absolute inset-0 rounded-[5px] ring-1 ring-inset ring-white/[0.07]" />
    </div>
  );
}

function Progress({ book }: { book: ShelfBook }) {
  if (book.progress === null) {
    return (
      <p className="text-label text-dim tabular-nums">
        {book.format === "epub" ? "EPUB" : "PDF"} · {formatSize(book.sizeBytes)}
      </p>
    );
  }
  if (book.progress >= FINISHED) return <p className="text-label text-fog">Finished</p>;
  const percent = Math.round(book.progress * 100);
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/[0.07]">
        <span className="block h-full rounded-full bg-paper/60" style={{ width: `${Math.max(2, percent)}%` }} />
      </span>
      <span className="text-label text-fog tabular-nums">{percent}%</span>
    </div>
  );
}

function BookCard({ book }: { book: ShelfBook }) {
  return (
    <Link
      href={`/book/${book.id}`}
      className="group flex min-w-0 flex-col gap-2.5 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
    >
      <Cover book={book} />
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="line-clamp-2 text-[13px] font-medium leading-snug text-paper">{book.title}</h3>
        {book.author ? <p className="truncate text-label text-dim">{book.author}</p> : null}
        <div className="mt-0.5">
          <Progress book={book} />
        </div>
      </div>
    </Link>
  );
}

export const GRID = "grid grid-cols-[repeat(auto-fill,minmax(136px,1fr))] gap-x-5 gap-y-8";

function Grid({ books }: { books: ShelfBook[] }) {
  return (
    <div className={GRID}>
      {books.map((book) => (
        <BookCard key={book.id} book={book} />
      ))}
    </div>
  );
}

export function BookList({ shelves, recent }: { shelves: Shelf[]; recent: ShelfBook[] }) {
  return (
    <div className="flex flex-col gap-12">
      {recent.length ? (
        <section aria-labelledby="recent" className="flex flex-col gap-4">
          <h2 id="recent" className="text-title text-paper">
            Continue reading
          </h2>
          <Grid books={recent} />
        </section>
      ) : null}
      {shelves.map((shelf) => (
        <section key={shelf.folder} aria-label={shelf.folder} className="flex flex-col gap-4">
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
