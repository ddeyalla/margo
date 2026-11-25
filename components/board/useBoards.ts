"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Board, BoardSummary } from "@/lib/shared/boards";
import type { BookId } from "@/lib/shared/types";
import { chapterBoard, createBoard, listBoards, removeBoard, renameBoard } from "./api";

/** Where the open board is drawn: small in the side panel's Board tab, or over the book with the tutor's tools. */
export type BoardPlace = "panel" | "full";

/** The chapter the reader is in, as a board made now is about, or null outside the table of contents. */
export type BoardContext = () => { chapter: string; labels: string[] } | null;

export interface BoardsApi {
  boards: BoardSummary[];
  /** The board being drawn on, and where. One editor per board, ever: moving it closes it in one place first. */
  open: { id: string; place: BoardPlace } | null;
  show(id: string, place: BoardPlace): void;
  close(): void;
  /** Reads the list again, after a save names a new file or another window changed it. */
  refresh(): void;
  /** Opens the board of the chapter being read, making it the first time. */
  openChapter(place: BoardPlace): Promise<void>;
  /** A new, empty board of the reader's, opened in the panel. */
  create(title: string): Promise<void>;
  /** A board made from a chat diagram, opened over the book; the same diagram opens the same board. */
  fromDiagram(source: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
}

const summary = (board: Board): BoardSummary => ({ ...board, editedAt: null });

/** The book's whiteboards and which one is open. Failures go to `onError`, worded for the reader. */
export function useBoards(bookId: BookId, initial: readonly Board[], context: BoardContext, onError: (text: string) => void): BoardsApi {
  const [boards, setBoards] = useState<BoardSummary[]>(() => initial.map(summary));
  const [open, setOpen] = useState<BoardsApi["open"]>(null);

  const refresh = useCallback(() => {
    listBoards(bookId).then(setBoards, () => undefined);
  }, [bookId]);
  useEffect(refresh, [refresh]);

  return useMemo((): BoardsApi => {
    const added = (board: Board) => setBoards((current) => [summary(board), ...current.filter((b) => b.id !== board.id)]);
    const failed = (failure: unknown, doing: string) => onError(failure instanceof Error ? failure.message : `${doing} failed.`);

    const openChapter = async (place: BoardPlace) => {
      const where = context();
      if (!where) {
        onError("Open a chapter first: a chapter's board belongs to the chapter you're reading.");
        return;
      }
      try {
        const board = await chapterBoard(bookId, where.chapter, where.labels);
        if (!boards.some((b) => b.id === board.id)) added(board);
        setOpen((current) => (current?.id === board.id ? current : { id: board.id, place }));
      } catch (failure) {
        failed(failure, "Opening the chapter's board");
      }
    };

    const create = async (title: string) => {
      const where = context();
      try {
        const board = await createBoard(bookId, { title, chapter: where?.chapter ?? null, labels: where?.labels ?? [] });
        added(board);
        setOpen({ id: board.id, place: "panel" });
      } catch (failure) {
        failed(failure, "Making the board");
      }
    };

    const fromDiagram = async (source: string) => {
      const where = context();
      try {
        /* Excalidraw is large: it loads with the first diagram opened as a board, not with the chat. */
        const { mermaidBoard } = await import("./mermaid");
        const { title, text } = await mermaidBoard(source);
        const board = await createBoard(bookId, { title, chapter: where?.chapter ?? null, labels: where?.labels ?? [], text, source });
        if (!boards.some((b) => b.id === board.id)) added(board);
        setOpen({ id: board.id, place: "full" });
      } catch (failure) {
        onError(`The diagram couldn't be turned into a board. ${failure instanceof Error ? failure.message : ""}`.trim());
      }
    };

    const rename = async (id: string, title: string) => {
      try {
        const board = await renameBoard(bookId, id, title);
        setBoards((current) => current.map((b) => (b.id === id ? { ...b, title: board.title } : b)));
      } catch (failure) {
        failed(failure, "Renaming the board");
      }
    };

    const remove = async (id: string) => {
      try {
        await removeBoard(bookId, id);
        setBoards((current) => current.filter((b) => b.id !== id));
        setOpen((current) => (current?.id === id ? null : current));
      } catch (failure) {
        failed(failure, "Removing the board");
      }
    };

    return {
      boards,
      open,
      show: (id, place) => setOpen({ id, place }),
      close: () => {
        setOpen(null);
        refresh();
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
