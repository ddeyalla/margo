"use client";

import { useEffect, useEffectEvent } from "react";
import { isTextEntry } from "@/lib/client/keys";

/** A ⌘ (or Ctrl) shortcut, matched on the physical key so it works in any keyboard layout. */
export interface Shortcut {
  code: string;
  shift: boolean;
  /** Leaves the key to a text field that has focus, such as ⌘⇧H in a question. */
  skipInText?: boolean;
  run(): void;
}

/** Keys that turn the page in Pages mode. */
const PAGE_KEYS: Record<string, 1 | -1> = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 };

/** Lists, toolbars, the progress bar and the side panel use the arrow keys themselves, so those keys don't turn pages there. */
const usesArrows = (target: EventTarget | null, panelId: string) =>
  target instanceof Element && !!target.closest(`nav, [role="toolbar"], [role="tablist"], [role="menu"], [role="slider"], [data-board-pane], #${panelId}`);

/**
 * The book page's keys, listened for on the window; keys from the EPUB's frame are forwarded there too.
 * Esc goes to `closeFirst` alone when it is given; otherwise the first matching shortcut wins, then Esc,
 * then the page keys when `onPageKey` is given.
 */
export function useShortcuts({
  shortcuts,
  plainKeysOff,
  closeFirst,
  onEscape,
  onPageKey,
  panelId,
}: {
  shortcuts: Shortcut[];
  /** Leaves keys without ⌘ to something else, such as the review sheet's Space, 1 to 4 and Esc. */
  plainKeysOff: boolean;
  /** Something open that Esc closes before anything else, wherever focus is, such as the highlight menu. That press does nothing more. */
  closeFirst: (() => void) | null;
  onEscape(): void;
  onPageKey: ((direction: 1 | -1) => void) | null;
  panelId: string;
}) {
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === "Escape" && closeFirst) {
      closeFirst();
      return;
    }
    if (plainKeysOff && !mod) return;
    const shortcut = mod && !event.altKey
      ? shortcuts.find((entry) => entry.code === event.code && entry.shift === event.shiftKey && !(entry.skipInText && isTextEntry(event.target)))
      : undefined;
    if (shortcut) {
      event.preventDefault();
      shortcut.run();
    } else if (event.key === "Escape" && !isTextEntry(event.target)) {
      onEscape();
    } else if (
      onPageKey &&
      event.key in PAGE_KEYS &&
      !mod &&
      !event.shiftKey &&
      !event.altKey &&
      !isTextEntry(event.target) &&
      !usesArrows(event.target, panelId)
    ) {
      event.preventDefault();
      onPageKey(PAGE_KEYS[event.key]);
    }
  });

  /* Registered once, so this listener keeps running before ones added later, such as the highlight menu's. */
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
}
