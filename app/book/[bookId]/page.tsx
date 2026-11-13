import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { BookWorkspace } from "@/components/book/BookWorkspace";
import { findBook } from "@/lib/server/library";
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
  const found = await findBook(bookId);
  if (!found) notFound();
  const { book } = found;
  const [state, settings] = await Promise.all([readBookState(book.id), readSettings()]);
  return (
    <BookWorkspace
      book={{ id: book.id, format: book.format, relPath: book.relPath, fileTitle: book.fileTitle }}
      initialState={state}
      savedProvider={settings.provider}
    />
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
