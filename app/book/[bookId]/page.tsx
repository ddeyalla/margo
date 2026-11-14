import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { FolderX } from "lucide-react";
import { BookWorkspace } from "@/components/book/BookWorkspace";
import { EmptyState } from "@/components/ui";
import { findBook, libraryProblem, type FoundBook } from "@/lib/server/library";
import { bookRevision } from "@/lib/server/revision";
import { readSettings } from "@/lib/server/settings";
import { readBookState } from "@/lib/server/store";

export default function BookPage({ params }: PageProps<"/book/[bookId]">) {
  return (
    <Suspense fallback={<BookSkeleton />}>
      <Book params={params} />
    </Suspense>
  );
}

async function Book({ params }: Pick<PageProps<"/book/[bookId]">, "params">) {
  await connection();
  const { bookId } = await params;
  let found: FoundBook | null;
  try {
    found = await findBook(bookId);
  } catch (error) {
    return <LibraryUnavailable message={libraryProblem(error)} />;
  }
  if (!found) notFound();
  const { book } = found;
  /* Read before the state, so a write in between shows as a change instead of being missed. */
  const revision = await bookRevision(book.id);
  const [state, settings] = await Promise.all([readBookState(book.id), readSettings()]);
  return (
    <BookWorkspace
      key={revision}
      book={{ id: book.id, format: book.format, relPath: book.relPath, fileTitle: book.fileTitle }}
      initialState={state}
      savedProvider={settings.provider}
      savedPdfTheme={settings.pdfPage}
      savedReadingMode={settings.readingMode}
      savedEpubTheme={settings.epubPage}
      savedBoldStarts={settings.boldStarts}
      savedReadingFont={settings.readingFont}
      savedChaptersOpen={settings.chaptersOpen}
      savedPanelTab={settings.panelTab}
    />
  );
}

function LibraryUnavailable({ message }: { message: string }) {
  return (
    <div className="flex h-dvh flex-col bg-ink">
      <EmptyState icon={<FolderX />} title="Your library is not set up yet" body={message}>
        <Link
          href="/"
          className="press mt-3 rounded-sm bg-panel-raised px-2.5 py-1.5 text-label font-medium text-fog transition-colors duration-[var(--duration-fast)] hover:bg-panel-hover hover:text-paper"
        >
          Back to library
        </Link>
      </EmptyState>
    </div>
  );
}

function BookSkeleton() {
  return (
    <div className="flex h-dvh flex-col bg-ink">
      <div className="h-11 shrink-0 bg-shell" />
      <div className="flex-1 bg-page" />
    </div>
  );
}
