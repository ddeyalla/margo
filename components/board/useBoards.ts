"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Board, BoardSummary } from "@/lib/shared/boards";
import type { BookId } from "@/lib/shared/types";
import { chapterBoard, createBoard, listBoards, removeBoard, renameBoard } from "./api";

/** The chapter the reader is in, as a board made now is about, or null outside the table of contents. */
export type BoardContext = () => { chapter: string; labels: string[]; occurrence?: number } | null;

export interface BoardsApi {
  boards: BoardSummary[];
  /** The board pane: null while it's closed, its id null while it lists the book's boards. One board is open at a time. */
  open: { id: string | null } | null;
  /** Opens a board in the pane. */
  show(id: string): void;
  /** Opens the pane on the list of boards. */
  list(): void;
  /** Closes the pane; false only when the open board couldn't be saved and stayed open, not when a later request took over. */
  close(): Promise<boolean>;
  /**
   * The open board's leaving check, set by its editor: it saves the board and says whether it may go. Every change of
   * board waits for it, so a board whose save fails stays open with the reader's drawing.
   */
  guard(leave: (() => Promise<boolean>) | null): void;
  /** Reads the list again, after a save names a new file or another window changed it. */
  refresh(): void;
  /** Opens the board of the chapter being read, making it the first time. */
  openChapter(): Promise<void>;
  /** A new, empty board of the reader's, opened in the pane. */
  create(title: string): Promise<void>;
  /** A board made from a chat diagram, opened in the pane; the same diagram opens the same board. */
  fromDiagram(source: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
}

const summary = (board: Board): BoardSummary => ({ ...board, editedAt: null });

/** The book's whiteboards and which one is open. Failures go to `onError`, worded for the reader. */
export function useBoards(bookId: BookId, initial: readonly Board[], context: BoardContext, onError: (text: string) => void): BoardsApi {
  const [boards, setBoards] = useState<BoardSummary[]>(() => initial.map(summary));
  const [open, setOpen] = useState<BoardsApi["open"]>(null);
  /* The pane as it is now, for a request made through an older render, such as the chat's link to the boards. */
  const openNow = useRef<BoardsApi["open"]>(null);
  /* Only the latest request lands: a listing that answers after a change made here would put back the old list, and
     an opening that answers after a later one would replace the board the reader asked for since. */
  const listing = useRef(0);
  const opening = useRef(0);
  const leaving = useRef<(() => Promise<boolean>) | null>(null);

  const refresh = useCallback(() => {
    const ticket = ++listing.current;
    listBoards(bookId).then((list) => ticket === listing.current && setBoards(list), () => undefined);
  }, [bookId]);
  useEffect(refresh, [refresh]);

  return useMemo((): BoardsApi => {
    const changed = (update: (current: BoardSummary[]) => BoardSummary[]) => {
      listing.current++;
      setBoards(update);
    };
    const added = (board: Board) => changed((current) => [summary(board), ...current.filter((b) => b.id !== board.id)]);
    /**
     * Moves the pane to `next` once the open board, if it is a different one, has saved and may go: "kept" when it
     * couldn't save and stayed open, "stale" when a later request took over meanwhile.
     */
    const go = async (next: BoardsApi["open"], ticket = ++opening.current): Promise<"done" | "kept" | "stale"> => {
      const now = openNow.current;
      if (now?.id && now.id !== next?.id && leaving.current && !(await leaving.current())) return "kept";
      if (ticket !== opening.current) return "stale";
      openNow.current = next;
      setOpen(next);
      return "done";
    };
    const failed = (failure: unknown, doing: string) => onError(failure instanceof Error ? failure.message : `${doing} failed.`);

    const openChapter = async () => {
      const where = context();
      if (!where) {
        onError("Open a chapter first: a chapter's board belongs to the chapter you're reading.");
        return;
      }
      const ticket = ++opening.current;
      try {
        const board = await chapterBoard(bookId, where.chapter, where.labels, where.occurrence);
        if (!boards.some((b) => b.id === board.id)) added(board);
        await go({ id: board.id }, ticket);
      } catch (failure) {
        failed(failure, "Opening the chapter's board");
      }
    };

    const create = async (title: string) => {
      const where = context();
      const ticket = ++opening.current;
      try {
        const board = await createBoard(bookId, { title, chapter: where?.chapter ?? null, labels: where?.labels ?? [] });
        added(board);
        await go({ id: board.id }, ticket);
      } catch (failure) {
        failed(failure, "Making the board");
      }
    };

    const fromDiagram = async (source: string) => {
      const where = context();
      const ticket = ++opening.current;
      try {
        /* Excalidraw is large: it loads with the first diagram opened as a board, not with the chat. */
        const { mermaidBoard } = await import("./mermaid");
        const { title, text } = await mermaidBoard(source);
        const board = await createBoard(bookId, { title, chapter: where?.chapter ?? null, labels: where?.labels ?? [], text, source });
        if (!boards.some((b) => b.id === board.id)) added(board);
        await go({ id: board.id }, ticket);
      } catch (failure) {
        onError(`The diagram couldn't be turned into a board. ${failure instanceof Error ? failure.message : ""}`.trim());
      }
    };

    const rename = async (id: string, title: string) => {
      try {
        const board = await renameBoard(bookId, id, title);
        changed((current) => current.map((b) => (b.id === id ? { ...b, title: board.title } : b)));
      } catch (failure) {
        failed(failure, "Renaming the board");
      }
    };

    const remove = async (id: string) => {
      try {
        /* The open board saves before it goes, so the file it leaves in the notes has the reader's last edits. */
        if (openNow.current?.id === id && (await go({ id: null })) !== "done") return;
        await removeBoard(bookId, id);
        changed((current) => current.filter((b) => b.id !== id));
        if (openNow.current?.id === id) openNow.current = { id: null };
        setOpen((current) => (current?.id === id ? { id: null } : current));
      } catch (failure) {
        failed(failure, "Removing the board");
      }
    };

    return {
      boards,
      open,
      show: (id) => void go({ id }),
      list: () => {
        void go({ id: null }).then((result) => result === "done" && refresh());
      },
      close: async () => {
        const result = await go(null);
        if (result === "done") refresh();
        return result !== "kept";
      },
      guard: (leave) => {
        leaving.current = leave;
      },
      refresh,
      openChapter,
      create,
      fromDiagram,
      rename,
      remove,
    };
  }, [bookId, boards, open, context, onError, refresh]);
}
