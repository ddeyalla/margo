"use client";

import { useState } from "react";
import { MessageSquare, Pencil, Plus, Shapes, Trash2, X } from "lucide-react";
import { Button, EmptyState, Field, IconButton, PaneHeader } from "@/components/ui";
import type { BoardSummary } from "@/lib/shared/boards";
import type { BookId, ProviderId } from "@/lib/shared/types";
import { useChapter, type PlaceStore } from "@/components/book/place";
import type { BoardContext, BoardsApi } from "./useBoards";
import { WhiteboardSheet } from "./WhiteboardSheet";

/** A one-line form: a field and a button, sent with Enter, cleared once sent. */
function LineForm({ label, placeholder, button, onSend }: { label: string; placeholder: string; button: React.ReactNode; onSend(text: string): void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim()) return;
        onSend(text.trim());
        setText("");
      }}
    >
      <Field aria-label={label} value={text} onChange={(event) => setText(event.target.value)} placeholder={placeholder} className="flex-1" />
      <Button type="submit" size="sm" disabled={!text.trim()}>
        {button}
      </Button>
    </form>
  );
}

function BoardRow({ board, onOpen, onRename, onRemove }: { board: BoardSummary; onOpen(): void; onRename(title: string): void; onRemove(): void }) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(board.title);
  if (renaming) {
    return (
      <li className="px-2 py-1.5">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim() && title.trim() !== board.title) onRename(title.trim());
            setRenaming(false);
          }}
        >
          <Field
            aria-label="Board title"
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={(event) => event.currentTarget.form?.requestSubmit()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setTitle(board.title);
                setRenaming(false);
              }
            }}
            className="w-full"
          />
        </form>
      </li>
    );
  }
  return (
    <li className="group/board flex items-center gap-1 rounded-lg py-1.5 pl-2 pr-1 hover:bg-tint">
      <button type="button" onClick={onOpen} className="press min-w-0 flex-1 text-left">
        <span className="block truncate text-label font-medium text-paper">{board.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-caption text-dim">
          <span className="shrink-0">{board.kind === "chapter" ? "Chapter board" : board.from ? "From the chat" : "Your board"}</span>
          {board.kind !== "chapter" && board.chapter ? (
            <>
              <span aria-hidden className="size-0.5 shrink-0 rounded-full bg-dim/60" />
              <span className="min-w-0 truncate">{board.chapter}</span>
            </>
          ) : null}
        </span>
      </button>
      <span className="flex shrink-0 opacity-0 transition-opacity duration-[var(--duration-fast)] focus-within:opacity-100 group-hover/board:opacity-100">
        <IconButton size="sm" label="Rename" onClick={() => setRenaming(true)}>
          <Pencil />
        </IconButton>
        {/* A chapter's board holds its draw-it-back history, which retention reads: it stays. */}
        {board.kind === "chapter" ? null : (
          <IconButton size="sm" label="Remove from this book (the file stays in your notes)" onClick={onRemove}>
            <Trash2 />
          </IconButton>
        )}
      </span>
    </li>
  );
}

/**
 * The board pane, beside the book or in its place, with the chat still open: the book's boards, or the one being
 * drawn on. New boards start empty or come from the tutor: asked in the chat to draw, it answers with a diagram that
 * opens as a board.
 */
export function BoardPane({
  boards,
  bookId,
  spot,
  context,
  provider,
  unavailable,
  theme,
  bookShown,
  side,
  onToggleBook,
  onSwap,
  onRecall,
  onAnswer,
}: {
  boards: BoardsApi;
  bookId: BookId;
  /** The reading place, followed so the chapter's board is the chapter being read. */
  spot: PlaceStore;
  context: BoardContext;
  provider: ProviderId | null;
  unavailable: string | null;
  theme: "light" | "dark";
  bookShown: boolean;
  /** Which side of the book the pane is on. */
  side: "left" | "right";
  onToggleBook(): void;
  /** Moves the pane to the other side of the book. */
  onSwap(): void;
  /** Draw it back closes the book and the chat while it lasts. */
  onRecall(active: boolean): void;
  /** Puts words in the chat's composer, with the board attached. */
  onAnswer(text: string): void;
}) {
  const open = boards.open;
  const entry = useChapter(spot);
  if (open?.id) {
    return (
      <WhiteboardSheet
        key={open.id}
        bookId={bookId}
        boardId={open.id}
        provider={provider}
        unavailable={unavailable}
        theme={theme}
        bookShown={bookShown}
        side={side}
        onToggleBook={onToggleBook}
        onSwap={onSwap}
        onRecall={onRecall}
        onAnswer={onAnswer}
        onBack={boards.list}
        onClose={boards.close}
      />
    );
  }

  const chapter = entry ? (context()?.chapter ?? null) : null;
  const chapterId = chapter ? boards.boards.find((board) => board.kind === "chapter" && board.chapter === chapter)?.id : undefined;
  const others = boards.boards.filter((board) => board.id !== chapterId);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneHeader>
        <span className="min-w-0 flex-1 truncate pl-1.5 text-label font-medium text-paper">Whiteboards</span>
        <IconButton size="sm" label="Close the whiteboards" onClick={boards.close}>
          <X />
        </IconButton>
      </PaneHeader>
      <div className="mx-auto flex w-full max-w-[520px] min-h-0 flex-1 flex-col">
        <div className="flex flex-col gap-2 px-3 py-3">
          {chapter ? (
            <button
              type="button"
              onClick={() => void boards.openChapter()}
              className="press flex items-center gap-2.5 rounded-lg bg-panel-raised px-3 py-2.5 text-left shadow-chip ring-1 ring-inset ring-line transition-colors duration-[var(--duration-fast)] hover:bg-panel-hover"
            >
              <Shapes className="size-4 shrink-0 text-fog" />
              <span className="min-w-0 flex-1">
                <span className="block text-label font-medium text-paper">This chapter’s board</span>
                <span className="block truncate text-caption text-dim">{chapter}</span>
              </span>
            </button>
          ) : null}
          <LineForm label="New board" placeholder="New board, by title" button={<Plus />} onSend={(title) => void boards.create(title)} />
          <p className="flex items-start gap-2 px-1 text-caption leading-relaxed text-dim">
            <MessageSquare aria-hidden className="mt-px size-3.5 shrink-0" />
            <span>To have the tutor draw one, ask in the chat: “Draw how attention works.” With a board open, it draws on that board; otherwise its diagram goes on the board about the same thing, or a new one.</span>
          </p>
        </div>
        {others.length ? (
          <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {others.map((board) => (
              <BoardRow
                key={board.id}
                board={board}
                onOpen={() => boards.show(board.id)}
                onRename={(title) => void boards.rename(board.id, title)}
                onRemove={() => void boards.remove(board.id)}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<Shapes />}
            title="Draw to remember"
            body="Sketch how ideas connect, in boxes and arrows. Boards are saved to your notes as Excalidraw files."
          />
        )}
      </div>
    </div>
  );
}
