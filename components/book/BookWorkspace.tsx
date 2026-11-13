"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EpubReader } from "@/components/reader/EpubReader";
import { PdfReader } from "@/components/reader/PdfReader";
import type { ReaderHandle, ReaderMeta } from "@/components/reader/types";
import { EmptyState } from "@/components/ui";
import type { BookFormat, BookId, BookState } from "@/lib/shared/types";
import { FileWarning } from "lucide-react";

export interface WorkspaceBook {
  id: BookId;
  format: BookFormat;
  relPath: string;
  fileTitle: string;
}

export function BookWorkspace({ book, initialState }: { book: WorkspaceBook; initialState: BookState }) {
  const readerRef = useRef<ReaderHandle>(null);
  const [meta, setMeta] = useState<ReaderMeta>({
    title: initialState.meta?.title ?? null,
    author: initialState.meta?.author ?? null,
  });
  const [chapter, setChapter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const title = meta.title || book.fileTitle;
  const Reader = book.format === "epub" ? EpubReader : PdfReader;

  return (
    <div className="flex h-dvh flex-col bg-ink">
      <title>{`${title} · rigg learn`}</title>
      <header className="flex h-11 shrink-0 items-center gap-1.5 bg-shell px-2">
        <Link
          href="/"
          aria-label="Back to library"
          title="Back to library"
          className="press flex size-7 shrink-0 items-center justify-center rounded-sm text-dim transition-colors duration-[var(--duration-fast)] hover:bg-white/[0.06] hover:text-paper"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="truncate text-[13px] font-medium text-paper">{title}</h1>
          {chapter ? <span className="truncate text-label text-dim">{chapter}</span> : null}
        </div>
      </header>
      <main className="relative min-h-0 flex-1">
        {error ? (
          <EmptyState icon={<FileWarning />} title="This book could not be opened" body={error} />
        ) : (
          <Reader
            ref={readerRef}
            bookId={book.id}
            initialPosition={initialState.position}
            onReady={(next) => setMeta((current) => ({ title: next.title ?? current.title, author: next.author ?? current.author }))}
            onSelectionChange={() => {}}
            onPositionChange={(_, chapterTitle) => setChapter(chapterTitle)}
            onError={setError}
          />
        )}
      </main>
    </div>
  );
}
