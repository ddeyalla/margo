import type { Ref } from "react";
import type { Anchor, BookId, Highlight, Position, ReadingMode, SelectionContext } from "@/lib/shared/types";
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
}

/** The page being read, numbered the way the book itself numbers it. Never an estimate. */
export type PageNumber =
  /** A page of the printed edition, from the EPUB's own page list. Labels may be roman numerals. */
  | { kind: "print"; label: string }
  /** foliate's location, one of the runs of about 1,500 bytes an EPUB with no page list is cut into. `current` counts from 0. */
  | { kind: "location"; current: number; total: number }
  | { kind: "pdf"; page: number; total: number };

/** Where the reader is, beyond the position that gets saved. */
export interface ReaderPlace {
  /** The entry of `meta.toc` the position falls in. */
  chapter: TocEntry | null;
  page: PageNumber | null;
  /** Page turns left before the chapter ends, when the reader can count them exactly; null otherwise. */
  pagesLeftInChapter: number | null;
  /** About how many minutes of reading the chapter has left, when the reader can tell; null otherwise. */
  minutesLeftInChapter: number | null;
}

/** The text just before the reader's place, for "where you left off" and a recap. */
export interface Glimpse {
  /** The last sentence or two, cut on a whole word. */
  text: string;
  /** The text before it, for the tutor. */
  before: string;
}

/** The one interface both readers expose, so the toolbar and panel never check the format. */
export interface ReaderHandle {
  /** Reads the current selection with its surrounding text and anchor. */
  getSelection(): SelectionContext | null;
  clearSelection(): void;
  goTo(anchor: Anchor): Promise<void>;
  /**
   * Goes to a quoted passage and says whether it is still there: false when the anchor no longer resolves in this
   * copy of the book, or lands on other text, as after a re-import of a different edition.
   */
  findPassage(anchor: Anchor, text: string): Promise<boolean>;
  /** Jumps to a table of contents entry this reader reported. */
  goToEntry(entry: TocEntry): Promise<void>;
  /** Turns to the next (1) or previous (-1) page. */
  turnPage(direction: 1 | -1): void;
  /** Jumps to a share of the way through the book, from 0 at the start to 1 at the end. */
  seek(fraction: number): void;
  /**
   * Draws a highlight now if its passage is on screen, and again whenever its page or section renders.
   * `made` marks one the reader has just made, which glows once as it first appears.
   */
  showHighlight(highlight: Highlight, made?: boolean): void;
  removeHighlight(id: string): void;
  /** The text just before `position`, or null while the page is not ready or has no text there. */
  peek(position: Position): Glimpse | null;
}

export interface ReaderProps {
  ref: Ref<ReaderHandle>;
  bookId: BookId;
  initialPosition: Position | null;
  /** Switching keeps the passage being read in view. */
  mode: ReadingMode;
  onReady(meta: ReaderMeta): void;
  /** Fires when a selection settles, moves on scroll, or clears (null). */
  onSelectionChange(rect: SelectionRect | null): void;
  /** Fires as the reader scrolls; callers debounce saving it. */
  onPositionChange(position: Position, place: ReaderPlace): void;
  /** The book could not be opened. */
  onError(failure: OpenFailure): void;
  /** The reader clicked a drawn highlight (with no text selected); `rect` is its box in the viewport. */
  onHighlightClick(id: string, rect: SelectionRect): void;
  /** The reader scrolled, turned the page or pressed a page key, as opposed to the book settling in place. */
  onInteract?(): void;
}
