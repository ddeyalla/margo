"use client";

import { useEffect, useState } from "react";
import { createResizableController } from "@ui-sdk/react/resizable";

export const PANEL_ID = "tutor-panel";

/** The resizable layout of book and tutor panel, and whether the panel is open. */
export function useTutorPanel() {
  const [layout] = useState(createResizableController);
  const [open, setOpen] = useState(true);
  const isOpen = () => !layout.isCollapsed(PANEL_ID);
  const sync = () => setOpen(isOpen());

  /* A layout restored from an earlier visit may start with the panel collapsed; read it once the group has attached. */
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(!layout.isCollapsed(PANEL_ID)));
    return () => cancelAnimationFrame(frame);
  }, [layout]);

  return {
    layout,
    open,
    isOpen,
    /** Reads the panel's state again after the layout changed. */
    sync,
    toggle: () => (isOpen() ? layout.collapse(PANEL_ID) : layout.expand(PANEL_ID)),
    expand: () => {
      if (!isOpen()) layout.expand(PANEL_ID);
    },
    collapse: () => layout.collapse(PANEL_ID),
  };
}

export type TutorPanel = ReturnType<typeof useTutorPanel>;
