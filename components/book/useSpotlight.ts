"use client";

import { useRef, useState } from "react";
import type { TutorPanel } from "./useTutorPanel";

/**
 * The spotlight dims all but one paragraph and clears the chrome away. The tutor panel folds away with it
 * and comes back afterwards if it was open. `available` says whether the book has a page to spotlight.
 */
export function useSpotlight(panel: TutorPanel, available: boolean, onStart: () => void) {
  const [on, setOn] = useState(false);
  const panelWasOpen = useRef(false);

  const end = () => {
    setOn(false);
    if (panelWasOpen.current) panel.expand();
  };

  const toggle = () => {
    if (on) return end();
    if (!available) return;
    panelWasOpen.current = panel.isOpen();
    if (panelWasOpen.current) panel.collapse();
    onStart();
    setOn(true);
  };

  return { on, end, toggle };
}
