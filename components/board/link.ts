"use client";

import { createContext, useContext, useState } from "react";
import { createStore, type Store } from "@/components/ui/store";
import { boardOpsIn, type BoardMention, type BoardOp } from "@/lib/shared/boards";
import type { ChatMessage } from "@/lib/shared/types";

/** The whiteboard open in its pane, as the chat reaches it. */
export interface OpenBoard {
  id: string;
  title: string;
  /** The board as the tutor reads it now, with which element each short id stands for. */
  mention(): BoardMention;
  /** Puts changes on the board as suggestions, placed through the ids they were written against. */
  suggest(ops: readonly BoardOp[], ids: Record<string, string>): Placed;
}

/** How an answer's changes went on its board: how many became suggestions, and how many no longer fit it. */
export interface Placed {
  added: number;
  dropped: number;
}

/**
 * Where the chat and the board meet. The open board registers here; the composer attaches it to a message; an
 * answer's changes go on it once, as suggestions, opening the board first when it isn't the one open.
 */
export interface BoardLink {
  open: Store<OpenBoard | null>;
  /** The answers whose changes went on a board, by answer key. */
  placed: Store<Record<string, Placed>>;
  /** Words to put in the composer, with the board attached: an answer to the tutor's question about it. */
  draft: Store<{ text: string } | null>;
  /** Puts an answer's changes on the board it was about, once. */
  place(key: string, board: BoardMention, ops: readonly BoardOp[]): void;
  /** The board in the pane is ready to draw on, or gone (null). */
  attach(board: OpenBoard | null): void;
  /** Opens a board in the pane. */
  show(id: string): void;
}

/** What an answer changes on the board its question was about: the ops, or why they can't be used. */
export interface AnswerChanges {
  key: string;
  board: BoardMention;
  ops: BoardOp[] | string;
}

/**
 * The changes the answer at `index` makes to a board: read from its ```board fence against the board the reader's
 * message carried. Null for an answer with no fence, one stopped early, or one to a message about no board.
 */
export const answerChanges = (threadId: string, messages: readonly ChatMessage[], index: number): AnswerChanges | null => {
  const answer = messages[index];
  if (answer?.role !== "assistant" || answer.partial) return null;
  let asked = index - 1;
  while (asked >= 0 && messages[asked].role === "user" && !messages[asked].board) asked--;
  const board = asked >= 0 && messages[asked].role === "user" ? messages[asked].board : undefined;
  if (!board) return null;
  const ops = boardOpsIn(answer.content, board.scene);
  return ops === null ? null : { key: `${threadId}:${index}`, board, ops };
};

export const BoardLinkContext = createContext<BoardLink | null>(null);

export const useBoardLink = () => useContext(BoardLinkContext);

/** The book's link between its chat and its boards. `show` opens a board in the pane. */
export function useCreateBoardLink(show: (id: string) => void): BoardLink {
  const [link] = useState((): BoardLink => {
    const open = createStore<OpenBoard | null>(null);
    const placed = createStore<Record<string, Placed>>({});
    /* Changes for a board that isn't open yet wait for it. */
    let waiting: { key: string; board: BoardMention; ops: readonly BoardOp[] } | null = null;
    const put = (board: OpenBoard, key: string, mention: BoardMention, ops: readonly BoardOp[]) => {
      if (placed.get()[key]) return;
      placed.set({ ...placed.get(), [key]: board.suggest(ops, mention.ids) });
    };
    return {
      open,
      placed,
      draft: createStore<{ text: string } | null>(null),
      place(key, board, ops) {
        if (placed.get()[key]) return;
        const current = open.get();
        if (current?.id === board.id) put(current, key, board, ops);
        else {
          waiting = { key, board, ops };
          show(board.id);
        }
      },
      show,
      attach(board) {
        open.set(board);
        if (board && waiting?.board.id === board.id) {
          const { key, board: mention, ops } = waiting;
          waiting = null;
          put(board, key, mention, ops);
        }
      },
    };
  });
  return link;
}
