import { Suspense } from "react";
import { connection } from "next/server";
import { BookOpen, FolderX } from "lucide-react";
import { BookList, GRID, type Shelf, type ShelfBook } from "@/components/library/BookList";
import { FolderForm } from "@/components/library/FolderForm";
import { FoldersControl } from "@/components/library/FoldersControl";
import { RefreshOnReturn } from "@/components/library/RefreshOnReturn";
import { EmptyState } from "@/components/ui";
import { BooksFolderMissing, getFolders } from "@/lib/server/config";
import { libraryProblem, scanLibrary } from "@/lib/server/library";
import { bookStateUpdatedAt, readBookState } from "@/lib/server/store";

const RECENT_LIMIT = 4;

async function Library() {
  await connection();
  let books;
  try {
    books = await scanLibrary();
  } catch (error) {
    if (error instanceof BooksFolderMissing) return <FolderSetup />;
    return (
      <>
        <Heading folders={foldersControl()} />
        <EmptyState icon={<FolderX />} title="Your library is not set up yet" body={libraryProblem(error)} />
      </>
    );
  }
  if (!books.length) {
    return (
      <>
        <Heading folders={foldersControl()} />
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
        cover: `/api/books/${book.id}/cover?v=${Date.parse(book.modifiedAt)}`,
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
      <Heading folders={foldersControl()}>
        {books.length} books in {shelves.size} folders
      </Heading>
      <BookList shelves={sorted} recent={recent} />
    </>
  );
}

/** The folders already chosen, with a button to change them. */
function foldersControl() {
  const { books, notes } = getFolders();
  return <FoldersControl books={books} notes={notes} />;
}

/** Shown until a books folder is set, in .env.local or in the app. */
function FolderSetup() {
  const { books, notes } = getFolders();
  return (
    <>
      <Heading />
      <EmptyState icon={<FolderX />} title="Choose your books folder" body="Pick the folder that holds your EPUB and PDF books.">
        <div className="mt-3 flex w-full justify-center">
          <FolderForm books={books} notes={notes} />
        </div>
      </EmptyState>
    </>
  );
}

function Heading({ children, folders }: { children?: React.ReactNode; folders?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-baseline gap-x-3">
      <h1 className="text-display text-paper">Library</h1>
      {children ? <span className="text-label text-dim tabular-nums">{children}</span> : null}
      {folders}
    </div>
  );
}

function LibrarySkeleton() {
  return (
    <>
      <Heading />
      <div aria-hidden className={GRID}>
        {Array.from({ length: 14 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2.5">
            <div className="aspect-[2/3] animate-pulse rounded-[5px] bg-panel" />
            <div className="h-3 w-4/5 animate-pulse rounded-xs bg-panel" />
            <div className="h-2.5 w-1/2 animate-pulse rounded-xs bg-panel" />
          </div>
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
        <RefreshOnReturn />
        <Suspense fallback={<LibrarySkeleton />}>
          <Library />
        </Suspense>
      </main>
    </div>
  );
}
