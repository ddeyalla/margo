import { Suspense } from "react";
import { connection } from "next/server";
import { BookOpen, FolderX, Library as LibraryIcon } from "lucide-react";
import { BookList, GRID, type Shelf, type ShelfBook } from "@/components/library/BookList";
import { FolderForm } from "@/components/library/FolderForm";
import { FoldersControl } from "@/components/library/FoldersControl";
import { MissingBooks } from "@/components/library/MissingBooks";
import { RefreshOnReturn } from "@/components/library/RefreshOnReturn";
import { EmptyState } from "@/components/ui";
import { ThemeControl } from "@/components/ui/theme";
import { BooksFolderMissing, getFolders } from "@/lib/server/config";
import { libraryProblem, readLibrary, type ScannedLibrary } from "@/lib/server/library";
import { listMissing, type MissingBooks as Missing } from "@/lib/server/missing-books";
import { bookStateUpdatedAt, readBookState } from "@/lib/server/store";

const RECENT_LIMIT = 4;

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

async function Library() {
  await connection();
  let library: ScannedLibrary;
  try {
    library = await readLibrary();
  } catch (error) {
    if (error instanceof BooksFolderMissing) return <FolderSetup />;
    return (
      <>
        <Heading folders={foldersControl()} />
        <EmptyState icon={<FolderX />} title="Your library is not set up yet" body={libraryProblem(error)} />
      </>
    );
  }
  const { books } = library;
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
      /* One unreadable state file shows that book from its file name, without progress, rather than failing the whole library. */
      const [state, updatedAt] = await Promise.all([
        readBookState(book.id).catch(() => null),
        bookStateUpdatedAt(book.id),
      ]);
      const shelfBook: ShelfBook = {
        id: book.id,
        format: book.format,
        title: state?.meta?.title || book.fileTitle,
        author: state?.meta?.author ?? book.fileAuthor,
        sizeBytes: book.sizeBytes,
        progress: state?.position?.fraction ?? null,
        cover: `/api/books/${book.id}/cover?v=${Date.parse(book.modifiedAt)}`,
      };
      return { folder: book.folder, shelfBook, readAt: state?.position ? updatedAt : null };
    }),
  );
  /* The list of missing books is a way back to lost data, never a reason the library fails to show. */
  const { missing, candidates } = await listMissing(library).catch((error: unknown): Missing => {
    console.warn("Could not list missing books:", error);
    return { missing: [], candidates: [] };
  });

  const shelves = new Map<string, ShelfBook[]>();
  for (const { folder, shelfBook } of entries) {
    const shelf = shelves.get(folder);
    if (shelf) shelf.push(shelfBook);
    else shelves.set(folder, [shelfBook]);
  }
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
        {plural(books.length, "book")} in {plural(shelves.size, "folder")}
      </Heading>
      <BookList shelves={sorted} recent={recent} />
      {missing.length ? (
        <div className="mt-12">
          <MissingBooks books={missing} candidates={candidates} />
        </div>
      ) : null}
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
    <div className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-2">
      <h1 className="text-display text-paper">Library</h1>
      {children ? <span className="mt-1.5 text-label text-dim tabular-nums">{children}</span> : null}
      <div className="ml-auto flex items-center gap-2">
        <ThemeControl />
      </div>
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
          <div key={index} className="flex flex-col gap-3 rounded-xl bg-panel p-2.5 pb-3 shadow-canvas">
            <div className="aspect-[2/3] animate-pulse rounded-md bg-tint" />
            <div className="mx-1 h-3 w-4/5 animate-pulse rounded-xs bg-tint" />
            <div className="mx-1 h-2.5 w-1/2 animate-pulse rounded-xs bg-tint" />
          </div>
        ))}
      </div>
    </>
  );
}

export default function Home() {
  return (
    <div className="min-h-full bg-ink">
      <header className="sticky top-0 z-10 flex h-12 items-center gap-2 bg-ink/80 px-3 backdrop-blur-md">
        <span className="flex h-7 items-center gap-2 rounded-full bg-panel-raised px-3 text-[13px] font-semibold text-paper shadow-chip">
          <LibraryIcon aria-hidden className="size-3.5 text-dim" />
          rigg learn
        </span>
      </header>
      <main className="mx-auto w-full max-w-[1180px] px-6 pb-24 pt-8">
        <RefreshOnReturn />
        <Suspense fallback={<LibrarySkeleton />}>
          <Library />
        </Suspense>
      </main>
    </div>
  );
}
