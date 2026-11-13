import { Suspense } from "react";
import { connection } from "next/server";
import { BookOpen, FolderX } from "lucide-react";
import { BookList, type Shelf, type ShelfBook } from "@/components/library/BookList";
import { EmptyState } from "@/components/ui";
import { ConfigError, getConfig } from "@/lib/server/config";
import { scanLibrary } from "@/lib/server/library";
import { bookStateUpdatedAt, readBookState } from "@/lib/server/store";

const RECENT_LIMIT = 4;

async function Library() {
  await connection();
  let books;
  try {
    books = await scanLibrary();
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    const message =
      error instanceof ConfigError
        ? error.message
        : missing
          ? `The books folder ${getConfig().booksDir} does not exist. Check BOOKS_DIR in .env.local.`
          : "The books folder could not be read.";
    return (
      <>
        <Heading />
        <EmptyState icon={<FolderX />} title="Your library is not set up yet" body={message} />
      </>
    );
  }
  if (!books.length) {
    return (
      <>
        <Heading />
        <EmptyState
          icon={<BookOpen />}
          title="No books yet"
          body="Add EPUB or PDF files to your books folder, in any subfolders you like, then reload."
        />
      </>
    );
  }

  const entries = await Promise.all(
    books.map(async (book) => {
      const [state, updatedAt] = await Promise.all([readBookState(book.id), bookStateUpdatedAt(book.id)]);
      const shelfBook: ShelfBook = {
        id: book.id,
        format: book.format,
        title: state.meta?.title || book.fileTitle,
        author: state.meta?.author ?? book.fileAuthor,
        sizeBytes: book.sizeBytes,
        progress: state.position?.fraction ?? null,
      };
      return { folder: book.folder, shelfBook, readAt: state.position ? updatedAt : null };
    }),
  );

  const shelves = new Map<string, ShelfBook[]>();
  for (const { folder, shelfBook } of entries) shelves.set(folder, [...(shelves.get(folder) ?? []), shelfBook]);
  const sorted: Shelf[] = [...shelves.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, list]) => ({ folder, books: list.sort((a, b) => a.title.localeCompare(b.title)) }));
  const recent = entries
    .filter((entry) => entry.readAt)
    .sort((a, b) => (b.readAt?.getTime() ?? 0) - (a.readAt?.getTime() ?? 0))
    .slice(0, RECENT_LIMIT)
    .map((entry) => entry.shelfBook);

  return (
    <>
      <Heading>
        {books.length} books in {shelves.size} folders
      </Heading>
      <BookList shelves={sorted} recent={recent} />
    </>
  );
}

function Heading({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mb-8 flex items-baseline gap-3">
      <h1 className="text-display text-paper">Library</h1>
      {children ? <span className="text-label text-dim tabular-nums">{children}</span> : null}
    </div>
  );
}

function LibrarySkeleton() {
  return (
    <>
      <Heading />
      <div aria-hidden className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2.5">
      {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="h-[132px] animate-pulse rounded-lg bg-panel" />
        ))}
      </div>
    </>
  );
}

export default function Home() {
  return (
    <div className="min-h-full bg-ink">
      <header className="sticky top-0 z-10 flex h-11 items-center gap-2 bg-shell px-4">
        <span className="text-[13px] font-semibold text-paper">rigg learn</span>
      </header>
      <main className="mx-auto w-full max-w-[1100px] px-6 pb-24 pt-10">
        <Suspense fallback={<LibrarySkeleton />}>
          <Library />
        </Suspense>
      </main>
    </div>
  );
}
