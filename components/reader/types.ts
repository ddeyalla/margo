import type { Ref } from "react";
import type { Anchor, BookId, Highlight, Position, SelectionContext } from "@/lib/shared/types";
import type { OpenFailure } from "./errors";

/** Where the selection sits on screen, in viewport coordinates, for placing the toolbar. */
export type SelectionRect = SelectionContext["rect"];

/** Where a table of contents entry leads: an EPUB href, or a point on a PDF page (`top` is a fraction from the page's top). */
export type TocTarget = { kind: "epub"; href: string } | { kind: "pdf"; page: number; top: number };

/** One line of a book's table of contents, flattened in reading order. `depth` is 0 for top-level entries. */
export interface TocEntry {
  label: string;
  depth: number;
  target: TocTarget;
}

/** What the reader learned about the book once it opened. */
export interface ReaderMeta {
  title: string | null;
  author: string | null;
  toc: TocEntry[];
  /** A PDF's page count; null for an EPUB, which has no fixed pages. */
  pageCount: number | null;
}

/** The one interface both readers expose, so the toolbar and panel never check the format. */
export interface ReaderHandle {
  /** Reads the current selection with its surrounding text and anchor. */
  getSelection(): SelectionContext | null;
  clearSelection(): void;
  goTo(anchor: Anchor): Promise<void>;
  /** Jumps to a table of contents entry this reader reported. */
  goToEntry(entry: TocEntry): Promise<void>;
  /** Draws a highlight now if its passage is on screen, and again whenever its page or section renders. */
  showHighlight(highlight: Highlight): void;
  removeHighlight(id: string): void;
}

export interface ReaderProps {
  ref: Ref<ReaderHandle>;
  bookId: BookId;
  initialPosition: Position | null;
  onReady(meta: ReaderMeta): void;
  /** Fires when a selection settles, moves on scroll, or clears (null). */
  onSelectionChange(rect: SelectionRect | null): void;
  /** Fires as the reader scrolls; callers debounce. `chapter` is the entry of `meta.toc` the position falls in. */
  onPositionChange(position: Position, chapter: TocEntry | null): void;
  /** The book could not be opened. */
  onError(failure: OpenFailure): void;
  /** The reader clicked a drawn highlight (with no text selected); `rect` is its box in the viewport. */
  onHighlightClick(id: string, rect: SelectionRect): void;
}
