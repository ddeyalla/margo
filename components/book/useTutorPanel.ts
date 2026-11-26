"use client";

import { useEffect, useRef, useState } from "react";
import { createResizableController } from "@ui-sdk/react/resizable";

export const PANEL_ID = "tutor-panel";
export const BOOK_PANE_ID = "reader-panel";

/** Which side of the book the board pane is on. */
export type BoardSide = "left" | "right";

/*
 * The board has a slot on each side of the book, and opens in one of them. Moving the book's pane in the page would
 * reload the book, which lives in a frame, so the board moves instead.
 */
export const BOARD_PANE_IDS: Record<BoardSide, string> = { left: "board-pane-left", right: "board-pane" };
/* Where each pane sits in the group, for reading sizes out of the layout. */
const INDEX: Record<string, number> = { [BOARD_PANE_IDS.left]: 0, [BOOK_PANE_ID]: 1, [BOARD_PANE_IDS.right]: 2, [PANEL_ID]: 3 };

const SIDE_KEY = "rigg-learn.board-side";

const savedSide = (): BoardSide => {
  try {
    return typeof window !== "undefined" && localStorage.getItem(SIDE_KEY) === "left" ? "left" : "right";
  } catch {
    return "right";
  }
};

/**
 * The resizable layout of the book, the board pane and the tutor panel, and which of them are open. The board pane
 * sits on either side of the book: beside it, or in its place with the book folded away, and the chat stays open.
 */
export function useTutorPanel() {
  const [layout] = useState(createResizableController);
  const [open, setOpen] = useState(true);
  const [boardOpen, setBoardOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(true);
  const [boardSide, setBoardSide] = useState<BoardSide>(savedSide);
  /* Set while the board moves sides: between closing one slot and opening the other, it isn't closed. */
  const moving = useRef(false);
  const isOpen = () => !layout.isCollapsed(PANEL_ID);
  const boardShownAt = (side: BoardSide) => !layout.isCollapsed(BOARD_PANE_IDS[side]);
  const sync = () => {
    setOpen(isOpen());
    setBoardOpen(boardShownAt("left") || boardShownAt("right"));
    setBookOpen(!layout.isCollapsed(BOOK_PANE_ID));
  };

  /* Set once the group has attached and the panes can be moved. */
  const [attached, setAttached] = useState(false);

  /* A layout restored from an earlier visit may start with the panel collapsed, or a board pane open with no board in it; read it once the group has attached. */
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      sync();
      setAttached(true);
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, after the group attaches
  }, [layout]);

  /** Opens the board's slot on `side`, at `size` percent, or close to half the room when it would open as a strip. */
  const openAt = (side: BoardSide, size?: number) => {
    const id = BOARD_PANE_IDS[side];
    if (layout.isCollapsed(id)) layout.expand(id);
    const now = layout.getLayout()[INDEX[id]] ?? 0;
    if (size !== undefined) layout.resize(id, `${size}%`);
    else if (now < 35) layout.resize(id, "45%");
  };

  /**
   * Folds the tutor panel away. Its room goes to the book, or to the board when the book is folded: the pane next to
   * it may be the board's empty slot, which can't take it, and the fold would otherwise be refused.
   */
  const collapsePanel = () => {
    layout.collapse(PANEL_ID);
    if (!isOpen()) return;
    const sizes = [...Object.values(layout.getLayout())];
    const to = layout.isCollapsed(BOOK_PANE_ID) ? INDEX[BOARD_PANE_IDS[boardShownAt("left") ? "left" : "right"]] : INDEX[BOOK_PANE_ID];
    sizes[to] += sizes[INDEX[PANEL_ID]];
    sizes[INDEX[PANEL_ID]] = 0;
    layout.setLayout(sizes);
  };

  return {
    layout,
    attached,
    open,
    isOpen,
    /** Reads the panes' state again after the layout changed. */
    sync,
    toggle: () => (isOpen() ? collapsePanel() : layout.expand(PANEL_ID)),
    expand: () => {
      if (!isOpen()) layout.expand(PANEL_ID);
    },
    collapse: collapsePanel,
    boardOpen,
    boardSide,
    bookOpen,
    isBookOpen: () => !layout.isCollapsed(BOOK_PANE_ID),
    /** Whether neither board slot is open. */
    isBoardClosed: () => !moving.current && !boardShownAt("left") && !boardShownAt("right"),
    /** Opens the board pane on its side. Where the window has no room for the book, the board and the chat at once, the board takes the book's place. */
    showBoard: () => {
      if (boardShownAt(boardSide)) return;
      const chatOpen = isOpen();
      moving.current = true;
      try {
        openAt(boardSide);
        /* Opening squeezed the chat shut, or found no room at all: the book makes way instead. */
        if ((!boardShownAt(boardSide) || (chatOpen && !isOpen())) && !layout.isCollapsed(BOOK_PANE_ID)) {
          layout.collapse(BOOK_PANE_ID);
          openAt(boardSide);
        }
        if (chatOpen && !isOpen()) layout.expand(PANEL_ID);
      } finally {
        moving.current = false;
      }
      sync();
    },
    /** Closes the board pane and gives the book its room back. */
    hideBoard: () => {
      if (layout.isCollapsed(BOOK_PANE_ID)) layout.expand(BOOK_PANE_ID);
      for (const id of Object.values(BOARD_PANE_IDS)) if (!layout.isCollapsed(id)) layout.collapse(id);
      sync();
    },
    /** Moves the board to the other side of the book, at the size it had. */
    swapBoard: () => {
      const to: BoardSide = boardSide === "left" ? "right" : "left";
      const from = BOARD_PANE_IDS[boardSide];
      const size = layout.getLayout()[INDEX[from]];
      if (!layout.isCollapsed(from)) {
        moving.current = true;
        try {
          layout.collapse(from);
          openAt(to, size);
        } finally {
          moving.current = false;
        }
      }
      setBoardSide(to);
      try {
        localStorage.setItem(SIDE_KEY, to);
      } catch {
        /* Remembered for this visit only. */
      }
      sync();
    },
    showBook: () => {
      if (layout.isCollapsed(BOOK_PANE_ID)) layout.expand(BOOK_PANE_ID);
      sync();
    },
    /** Folds the book away; its room goes to the board when one is open, rather than to whichever pane is next to it. */
    hideBook: () => {
      if (layout.isCollapsed(BOOK_PANE_ID)) return;
      const board = BOARD_PANE_IDS[boardSide];
      if (layout.isCollapsed(board)) layout.collapse(BOOK_PANE_ID);
      else {
        const sizes = layout.getLayout();
        const next = sizes.map((size, index) => (index === INDEX[PANEL_ID] ? size : 0));
        next[INDEX[board]] = sizes.reduce((sum, size, index) => (index === INDEX[PANEL_ID] ? sum : sum + size), 0);
        layout.setLayout(next);
      }
      sync();
    },
  };
}

export type TutorPanel = ReturnType<typeof useTutorPanel>;
