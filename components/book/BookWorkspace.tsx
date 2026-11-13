"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileWarning, PanelRight } from "lucide-react";
import { createResizableController, Resizable, ResizableHandle, ResizablePanel } from "@ui-sdk/react/resizable";
import { useProviders } from "@/components/chat/useProviders";
import { useTutor } from "@/components/chat/useTutor";
import { EpubReader } from "@/components/reader/EpubReader";
import { PdfReader } from "@/components/reader/PdfReader";
import { SelectionToolbar, type SelectionToolbarHandle } from "@/components/reader/SelectionToolbar";
import type { ReaderHandle, ReaderMeta, SelectionRect } from "@/components/reader/types";
import { EmptyState, IconButton } from "@/components/ui";
import { patchBookState } from "@/lib/client/api";
import type { Anchor, BookFormat, BookId, BookState, ProviderId, SelectionContext, TutorAction } from "@/lib/shared/types";
import { SidePanel, type PanelTab } from "./SidePanel";
import { usePositionSaver } from "./usePositionSaver";

export interface WorkspaceBook {
  id: BookId;
  format: BookFormat;
  relPath: string;
  fileTitle: string;
}

const PANEL_ID = "tutor-panel";

export function BookWorkspace({
  book,
  initialState,
  savedProvider,
}: {
  book: WorkspaceBook;
  initialState: BookState;
  savedProvider: ProviderId | null;
}) {
  const readerRef = useRef<ReaderHandle>(null);
  const toolbarRef = useRef<SelectionToolbarHandle>(null);
  const readerAreaRef = useRef<HTMLElement>(null);
  const [layout] = useState(createResizableController);
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState<PanelTab>("chat");
  const [meta, setMeta] = useState<ReaderMeta>({
    title: initialState.meta?.title ?? null,
    author: initialState.meta?.author ?? null,
  });
  const [chapter, setChapter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const title = meta.title || book.fileTitle;
  const savePosition = usePositionSaver(book.id);
  const tutor = useTutor(book.id, initialState.threads);
  const { providers, current: provider, choose: chooseProvider, unavailable } = useProviders(savedProvider);

  /* A layout restored from an earlier visit may start with the panel collapsed; read it once the group has attached. */
  useEffect(() => {
    const frame = requestAnimationFrame(() => setPanelOpen(!layout.isCollapsed(PANEL_ID)));
    return () => cancelAnimationFrame(frame);
  }, [layout]);

  /* The book's own title and author replace the file name once it has been opened. */
  const handleReady = (next: ReaderMeta) => {
    const merged = { title: next.title ?? meta.title, author: next.author ?? meta.author };
    setMeta(merged);
    const stored = initialState.meta;
    const title = merged.title ?? book.fileTitle;
    if (stored?.title !== title || stored?.author !== merged.author) {
      void patchBookState(book.id, { meta: { title, author: merged.author } });
    }
  };

  /* Selection rects arrive on every scroll frame; they go straight to the toolbar, never through state here. */
  const handleSelection = useCallback((rect: SelectionRect | null) => toolbarRef.current?.update(rect), []);
  const readerBounds = useCallback(() => readerAreaRef.current?.getBoundingClientRect() ?? null, []);
  const readSelection = useCallback(() => readerRef.current?.getSelection() ?? null, []);

  const showChat = () => {
    setTab("chat");
    if (layout.isCollapsed(PANEL_ID)) layout.expand(PANEL_ID);
  };

  const startThread = (action: TutorAction, selection: SelectionContext, question: string | null) => {
    if (!provider) return;
    readerRef.current?.clearSelection();
    showChat();
    tutor.start(action, selection, question, provider);
  };

  const jumpTo = (anchor: Anchor) => void readerRef.current?.goTo(anchor);

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
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h1 className="truncate text-[13px] font-medium text-paper">{title}</h1>
          {chapter ? <span className="truncate text-label text-dim">{chapter}</span> : null}
        </div>
        <IconButton
          label={panelOpen ? "Hide the tutor panel" : "Show the tutor panel"}
          active={panelOpen}
          aria-controls={PANEL_ID}
          onClick={() => (layout.isCollapsed(PANEL_ID) ? layout.expand(PANEL_ID) : layout.collapse(PANEL_ID))}
        >
          <PanelRight />
        </IconButton>
      </header>
      <Resizable
        controller={layout}
        autoSaveId="rigg-learn.book-layout"
        onLayoutChange={() => setPanelOpen(!layout.isCollapsed(PANEL_ID))}
        className="min-h-0 flex-1"
      >
        <ResizablePanel id="reader-panel" minSize="360px" className="min-w-0">
          <main ref={readerAreaRef} className="relative h-full min-w-0">
            {error ? (
              <EmptyState icon={<FileWarning />} title="This book could not be opened" body={error} />
            ) : (
              <Reader
                ref={readerRef}
                bookId={book.id}
                initialPosition={initialState.position}
                onReady={handleReady}
                onSelectionChange={handleSelection}
                onPositionChange={(position, chapterTitle) => {
                  setChapter(chapterTitle);
                  savePosition(position);
                }}
                onError={setError}
              />
            )}
          </main>
        </ResizablePanel>
        <ResizableHandle
          aria-label="Resize the tutor panel"
          className="relative z-10 w-px shrink-0 bg-line outline-none transition-colors duration-[var(--duration-fast)] before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-[''] focus-visible:bg-fog data-[dragging]:bg-line-strong data-[hovering]:bg-line-strong"
        />
        <ResizablePanel
          id={PANEL_ID}
          defaultSize="380px"
          minSize="300px"
          maxSize="50%"
          collapsible
          className="min-w-0 overflow-hidden"
        >
          <SidePanel
            tab={tab}
            onTabChange={setTab}
            tutor={tutor}
            providers={providers}
            provider={provider}
            unavailable={unavailable}
            onProvider={chooseProvider}
            onJump={jumpTo}
            onReply={(text) => provider && tutor.reply(text, provider)}
            onRetry={() => provider && tutor.retry(provider)}
          />
        </ResizablePanel>
      </Resizable>
      <SelectionToolbar
        ref={toolbarRef}
        bounds={readerBounds}
        readSelection={readSelection}
        disabledReason={unavailable}
        onAction={(action, selection) => startThread(action, selection, null)}
        onAsk={(question, selection) => startThread("ask", selection, question)}
        onDismiss={() => readerRef.current?.clearSelection()}
      />
    </div>
  );
}
