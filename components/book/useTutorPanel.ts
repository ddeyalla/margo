"use client";

import { useEffect, useState } from "react";
import { createResizableController } from "@ui-sdk/react/resizable";

export const PANEL_ID = "tutor-panel";
export const BOOK_PANE_ID = "reader-panel";
export const BOARD_PANE_ID = "board-pane";

/**
 * The resizable layout of the book, the board pane and the tutor panel, and which of them are open. The board pane
 * sits between the other two: beside the book, or in its place with the book folded away, and the chat stays open.
 */
export function useTutorPanel() {
  const [layout] = useState(createResizableController);
  const [open, setOpen] = useState(true);
  const [boardOpen, setBoardOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(true);
  const isOpen = () => !layout.isCollapsed(PANEL_ID);
  const sync = () => {
    setOpen(isOpen());
    setBoardOpen(!layout.isCollapsed(BOARD_PANE_ID));
    setBookOpen(!layout.isCollapsed(BOOK_PANE_ID));
  };

  /* A layout restored from an earlier visit may start with the panel collapsed; read it once the group has attached. */
  useEffect(() => {
    const frame = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, after the group attaches
  }, [layout]);

  return {
    layout,
    open,
    isOpen,
    /** Reads the panes' state again after the layout changed. */
    sync,
    toggle: () => (isOpen() ? layout.collapse(PANEL_ID) : layout.expand(PANEL_ID)),
    expand: () => {
      if (!isOpen()) layout.expand(PANEL_ID);
    },
    collapse: () => layout.collapse(PANEL_ID),
    boardOpen,
    bookOpen,
    isBookOpen: () => !layout.isCollapsed(BOOK_PANE_ID),
    /** Opens the board pane, at half the book's room the first time. */
    showBoard: () => {
      if (!layout.isCollapsed(BOARD_PANE_ID)) return;
      layout.expand(BOARD_PANE_ID);
      /* Opened at its minimum it's a strip; it starts with close to half the room, taken from the book. */
      if ((layout.getLayout()[1] ?? 0) < 35) layout.resize(BOARD_PANE_ID, "45%");
      sync();
    },
    /** Closes the board pane and gives the book its room back. */
    hideBoard: () => {
      if (layout.isCollapsed(BOOK_PANE_ID)) layout.expand(BOOK_PANE_ID);
      if (!layout.isCollapsed(BOARD_PANE_ID)) layout.collapse(BOARD_PANE_ID);
      sync();
    },
    showBook: () => {
      if (layout.isCollapsed(BOOK_PANE_ID)) layout.expand(BOOK_PANE_ID);
      sync();
    },
    hideBook: () => {
      if (!layout.isCollapsed(BOOK_PANE_ID)) layout.collapse(BOOK_PANE_ID);
      sync();
    },
  };
}

export type TutorPanel = ReturnType<typeof useTutorPanel>;
