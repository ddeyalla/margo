"use client";

import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { normalizeText, trimAfter, trimBefore } from "@/lib/shared/context";
import { countWords, minutesLeft } from "@/lib/shared/reading-time";
import { tailExcerpt } from "@/lib/shared/resume";
import type { Highlight, ReadingFont, ReadingTheme, SelectionContext } from "@/lib/shared/types";
import { blockText, insidePre, selectedRange, textAround, viewportRect } from "./dom";
import { openFailure } from "./errors";
import { addFixations, removeFixations, skipFixations } from "./fixations";
import { cssFamily } from "./fonts";
import { mergeLineBoxes, type Box } from "./rects";
import { blockAt, blockOf, installSpotlight, markBlock, READING_LINE, removeSpotlight } from "./spotlight";
import { epubToc, wholeChapterSections, type FoliateTocItem } from "./toc";
import type { PageNumber, ReaderProps, TocEntry } from "./types";

/* foliate-js ships no types. These cover the parts this adapter uses. */
interface FoliateRenderer extends HTMLElement {
  start: number;
  end: number;
  /** The visible length along the scrolling axis. */
  size: number;
  viewSize: number;
  /** In Pages mode, the screen of the section in view, and the section's screen count. */
  page: number;
  pages: number;
  /** In Pages mode, one running header per column on screen. */
  heads: Element[] | null;
  next(): Promise<void>;
  prev(): Promise<void>;
  render(): void;
  setStyles(css: string): void;
  getContents(): { doc: Document; index: number }[];
}

interface FoliateView extends HTMLElement {
  book: { metadata?: { title?: unknown; author?: unknown }; sections: { linear?: string }[]; toc?: FoliateTocItem[] };
  renderer: FoliateRenderer;
  /** Where the reader is, as of the last relocate: the visible range among other things. */
  lastLocation: { range?: Range } | null;
  /** Applied to every CFI foliate makes or resolves. A vendored patch adds it. */
  cfiFilter: ((node: Node) => number) | null;
  open(src: string): Promise<void>;
  init(options: { lastLocation: string | null; showTextStart: boolean }): Promise<void>;
  close(): void;
  goTo(target: string): Promise<unknown>;
  goToFraction(fraction: number): Promise<void>;
  resolveNavigation(target: string): { index: number } | undefined;
  getCFI(index: number, range: Range): string;
  addAnnotation(annotation: { value: string }): Promise<unknown>;
  deleteAnnotation(annotation: { value: string }): Promise<unknown>;
  getProgressOf(index: number, range: Range): { tocItem?: FoliateTocItem | null };
}

interface OverlayerModule {
  Overlayer: { highlight(rects: Iterable<Box>, options?: { color?: string }): SVGGElement };
}

/** foliate's call to draw one annotation in a section's overlay. */
interface DrawDetail {
  draw(draw: (rects: Iterable<Box>) => SVGElement): void;
  annotation: { value: string };
}

/** A CSS time token from the root, in milliseconds. The CSS build may rewrite 1200ms as 1.2s. */
const tokenMs = (name: string) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const amount = parseFloat(value) || 0;
  return value.endsWith("ms") ? amount : value.endsWith("s") ? amount * 1000 : amount;
};

interface RelocateDetail {
  cfi: string;
  fraction?: number;
  tocItem?: FoliateTocItem | null;
  /** The entry of the book's print page list the passage falls on. */
  pageItem?: { label?: string | null } | null;
  location?: { current: number; total: number };
  section?: { current: number };
}

/** The print page when the book has a page list, else foliate's location. */
const pageNumber = ({ pageItem, location }: RelocateDetail): PageNumber | null => {
  const label = pageItem?.label?.trim();
  if (label) return { kind: "print", label };
  return location ? { kind: "location", current: location.current, total: location.total } : null;
};

/** Words in each loaded section, counted once. */
const wordCounts = new WeakMap<Document, number>();
const wordsIn = (doc: Document): number => {
  let words = wordCounts.get(doc);
  if (words === undefined) {
    words = countWords(doc.body?.textContent ?? "");
    wordCounts.set(doc, words);
  }
  return words;
};

/**
 * What is left of a section that is one whole chapter. foliate pads each paginated section with a blank
 * screen at either end, and a screen holds a page per column; the section's last screen may fill only its
 * first column. Pages are counted in Pages mode only. For minutes, the screen or the stretch on view counts
 * as still to read, so the last screen says one minute rather than none; they need the section's document.
 */
const leftInSection = (
  renderer: FoliateRenderer,
  doc: Document | null,
  paged: boolean,
): { pages: number | null; minutes: number | null } => {
  const screens = renderer.pages - 2;
  const pages = paged && screens > 0 ? Math.max(0, screens - renderer.page) * (renderer.heads?.length || 1) : null;
  if (!doc || !renderer.viewSize) return { pages, minutes: null };
  const fractionLeft = paged ? (screens > 0 ? (screens - renderer.page + 1) / screens : NaN) : 1 - renderer.start / renderer.viewSize;
  return { pages, minutes: minutesLeft(wordsIn(doc), fractionLeft) };
};

/** Served from public/ and imported at runtime, never bundled. */
const FOLIATE_VIEW = "/vendor/foliate-js/view.js";
const FOLIATE_OVERLAYER = "/vendor/foliate-js/overlayer.js";
/** Wheel distance past a section's edge that turns to the next or previous section. */
const OVERSCROLL_TO_TURN = 260;
/** Wheel events further apart than this start a new overscroll gesture. */
const GESTURE_GAP_MS = 400;
/** Book text column width: about 66 characters of Literata at 18px. */
const COLUMN_WIDTH = "570px";
/** Keys that move through the book. */
const NAV_KEYS = new Set(["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
/** Panes at least this wide show two columns side by side in Pages mode. */
const TWO_COLUMNS_FROM = 1040;

/** Lets Pages mode use two columns on a wide pane and one on a narrow one; true if that changed. */
const fitColumns = (renderer: FoliateRenderer, paneWidth: number) => {
  const count = paneWidth >= TWO_COLUMNS_FROM ? "2" : "1";
  if (renderer.getAttribute("max-column-count") === count) return false;
  renderer.setAttribute("max-column-count", count);
  return true;
};

/** EPUB metadata values are strings, language maps, or contributor objects. */
const metaText = (value: unknown): string | null => {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) return value.map(metaText).filter(Boolean).join(", ") || null;
  if (value && typeof value === "object") {
    if ("name" in value) return metaText(value.name);
    return metaText(Object.values(value)[0]);
  }
  return null;
};

/** The page's @font-face rules with absolute URLs, so foliate's blob iframes can load Literata.
    URLs are resolved against their own stylesheet, since a blob document has no usable base.
    Read again only when the page's stylesheets change in number, as when one loads late. */
let fontFaces: { sheets: number; css: string } | null = null;
const pageFontFaces = (): string => {
  const sheets = document.styleSheets.length;
  if (fontFaces?.sheets !== sheets) fontFaces = { sheets, css: readFontFaces() };
  return fontFaces.css;
};

const readFontFaces = (): string => {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let cssRules: CSSRuleList;
    try {
      cssRules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(cssRules)) {
      if (rule instanceof CSSFontFaceRule) {
        const base = sheet.href ?? location.href;
        rules.push(rule.cssText.replace(/url\((['"]?)([^'")]+)\1\)/g, (_, _quote, url: string) => `url("${new URL(url, base).href}")`));
      }
    }
  }
  return rules.join("\n");
};

/**
 * The book's styles for the reading theme in force around `host`, set in `font`. The book's
 * frame can't see the page's CSS variables, so the theme's colours are read
 * here. Scroll mode pads the section's column top and bottom; in Pages mode
 * foliate keeps its own page margins. A font that isn't installed falls through to Literata.
 */
const readingCss = (host: HTMLElement, paged: boolean, font: ReadingFont) => {
  const style = getComputedStyle(host);
  const token = (name: string) => style.getPropertyValue(name).trim();
  const literata = `${token("--font-literata") || "Literata"}, Georgia, serif`;
  return `
${pageFontFaces()}
html { color-scheme: ${style.colorScheme}; }
html, body { background: transparent !important; }
body {
  color: ${token("--color-prose")} !important;
  font-family: ${font === null ? literata : `${cssFamily(font)}, ${literata}`} !important;
  font-size: 18px !important;
  line-height: 1.7 !important;
  padding: ${paged ? "0" : "56px 0 160px"} !important;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
body * { color: inherit !important; background-color: transparent !important; border-color: ${token("--prose-rule")} !important; }
body *:not(pre, pre *, code, kbd, samp) { font-family: inherit !important; }
p, li, blockquote, dd, dt { line-height: 1.7 !important; }
p { hyphens: auto; }
h1, h2, h3, h4, h5, h6 { color: ${token("--prose-heading")} !important; line-height: 1.3 !important; letter-spacing: -0.01em; }
a { text-decoration-color: color-mix(in srgb, currentColor 35%, transparent) !important; text-underline-offset: 3px; }
pre, code, kbd, samp { font-family: "JetBrains Mono", ui-monospace, Menlo, monospace !important; font-size: 0.82em !important; }
rl-fx { font-weight: ${token("--prose-fixation-weight")} !important; color: ${token("--prose-heading")} !important; }
:is(h1, h2, h3, h4, h5, h6, b, strong, th) rl-fx { font-weight: bolder !important; }
pre { background-color: ${token("--prose-wash")} !important; padding: 0.9em 1.1em !important; border-radius: 8px; white-space: pre-wrap !important; line-height: 1.55 !important; }
img { background-color: ${token("--prose-image")} !important; border-radius: 4px; }
hr { border: 0 !important; height: 1px; background-color: ${token("--prose-rule")} !important; }
::selection { background: ${token("--color-select-soft")}; }
`;
};

export function EpubReader({
  ref,
  bookId,
  initialPosition,
  mode,
  theme,
  boldStarts,
  font,
  spotlight,
  onInteract,
  onReady,
  onSelectionChange,
  onPositionChange,
  onError,
  onHighlightClick,
}: ReaderProps & {
  /** Restyles the book in place, so switching keeps the passage in view. The colours come from the surrounding reading theme. */
  theme: Exclude<ReadingTheme, "auto">;
  /** Sets the start of each word in bold. Switching keeps the passage in view. */
  boldStarts: boolean;
  /** The family the book is set in, or null for Literata. Restyles in place, like the theme. */
  font: ReadingFont;
  /** Dims all but the paragraph at the reading line. Colours only, so the place holds. */
  spotlight: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  /* Set once the book is open, when foliate can resolve a CFI to a section. */
  const openRef = useRef(false);
  /* Every highlight, drawn again into each section's overlay as foliate creates it. */
  const highlightsRef = useRef(new Map<string, Highlight>());
  /* Highlights the reader has just made, by CFI, with when their glow started: NaN until foliate first draws one. */
  const glowsRef = useRef(new Map<string, number>());
  const sectionRef = useRef<{ doc: Document; index: number } | null>(null);
  /* The book's table of contents, keyed by the foliate item each entry came from. */
  const tocRef = useRef(new Map<FoliateTocItem, TocEntry>());
  /* Sections that are one whole chapter, where the pages left in the section are the pages left in the chapter. */
  const wholeChaptersRef = useRef(new Set<number>());
  /* Pages mode: foliate lays sections out in columns and turns page by page, crossing sections itself. */
  const pagedRef = useRef(false);
  /* Turns to the next or previous section, ignoring presses while a turn is under way. */
  const turnRef = useRef<((direction: 1 | -1) => void) | null>(null);
  const [atSectionEnd, setAtSectionEnd] = useState(false);

  const chapterOf = (item: FoliateTocItem | null | undefined) => (item && tocRef.current.get(item)) ?? null;

  /* Draws every highlight again in the open section, with ranges resolved in its current DOM. */
  const drawHighlights = () => {
    for (const { anchor } of highlightsRef.current.values()) {
      if (anchor.kind === "epub") viewRef.current?.addAnnotation({ value: anchor.cfi }).catch(() => undefined);
    }
  };

  const readSelection = (): SelectionContext | null => {
    const view = viewRef.current;
    const section = sectionRef.current;
    if (!view || !section) return null;
    const range = selectedRange(section.doc);
    const rect = range && viewportRect(range, section.doc.defaultView?.frameElement);
    if (!range || !rect) return null;
    const { before, after } = textAround(range, section.doc.body);
    return {
      text: normalizeText(blockText(range.cloneContents(), insidePre(range.commonAncestorContainer))),
      before: trimBefore(before),
      after: trimAfter(after),
      anchor: { kind: "epub", cfi: view.getCFI(section.index, range) },
      chapterTitle: chapterOf(view.getProgressOf(section.index, range).tocItem)?.label ?? null,
      rect,
    };
  };

  useImperativeHandle(ref, () => ({
    getSelection: readSelection,
    clearSelection() {
      sectionRef.current?.doc.getSelection()?.removeAllRanges();
      onSelectionChange(null);
    },
    async goTo(anchor) {
      if (anchor.kind === "epub") await viewRef.current?.goTo(anchor.cfi);
    },
    async goToEntry(entry) {
      if (entry.target.kind === "epub") await viewRef.current?.goTo(entry.target.href);
    },
    turnPage(direction) {
      const renderer = openRef.current ? viewRef.current?.renderer : null;
      void (direction === 1 ? renderer?.next() : renderer?.prev());
    },
    seek(fraction) {
      if (openRef.current) void viewRef.current?.goToFraction(fraction);
    },
    showHighlight(highlight, made) {
      highlightsRef.current.set(highlight.id, highlight);
      if (made && highlight.anchor.kind === "epub") glowsRef.current.set(highlight.anchor.cfi, NaN);
      if (openRef.current && highlight.anchor.kind === "epub") {
        viewRef.current?.addAnnotation({ value: highlight.anchor.cfi }).catch(() => undefined);
      }
    },
    peek() {
      const view = viewRef.current;
      const section = sectionRef.current;
      const range = openRef.current ? view?.lastLocation?.range : null;
      if (!section || !range || range.startContainer.ownerDocument !== section.doc) return null;
      try {
        const { before } = textAround(range, section.doc.body);
        const text = tailExcerpt(normalizeText(before));
        return text ? { text, before: trimBefore(before, 6000) } : null;
      } catch {
        return null;
      }
    },
    removeHighlight(id) {
      const removed = highlightsRef.current.get(id)?.anchor;
      highlightsRef.current.delete(id);
      if (!openRef.current || removed?.kind !== "epub") return;
      const shared = [...highlightsRef.current.values()].some((h) => h.anchor.kind === "epub" && h.anchor.cfi === removed.cfi);
      if (!shared) viewRef.current?.deleteAnnotation({ value: removed.cfi }).catch(() => undefined);
    },
  }));

  const emitSelectionRect = useEffectEvent(() => {
    const section = sectionRef.current;
    const range = section && selectedRange(section.doc);
    onSelectionChange(range ? viewportRect(range, section.doc.defaultView?.frameElement) : null);
  });
  const emitReady = useEffectEvent(onReady);
  const emitPosition = useEffectEvent(onPositionChange);
  const emitError = useEffectEvent(onError);
  const emitHighlightClick = useEffectEvent(onHighlightClick);
  const initialCfi = useEffectEvent(() => (initialPosition?.kind === "epub" ? initialPosition.cfi : null));
  const modeNow = useEffectEvent(() => mode);
  const boldStartsNow = useEffectEvent(() => boldStarts);
  const spotlightNow = useEffectEvent(() => spotlight);
  const emitInteract = useEffectEvent(() => onInteract?.());
  /* A paragraph the reader clicked or selected stays bright until the page moves. */
  const pinnedRef = useRef(false);

  const spotColors = () => {
    const style = getComputedStyle(hostRef.current ?? document.body);
    return { prose: style.getPropertyValue("--color-prose").trim(), heading: style.getPropertyValue("--prose-heading").trim() };
  };

  /* The bright paragraph is the one at the reading line, in each section on screen. */
  const refreshSpot = useEffectEvent(() => {
    const renderer = openRef.current ? viewRef.current?.renderer : null;
    const host = hostRef.current;
    if (!renderer || !host || !spotlightNow() || pinnedRef.current) return;
    /* The reading line, in the page's coordinates, then in each section's own frame. */
    const area = host.getBoundingClientRect();
    const px = area.left + area.width * (pagedRef.current ? 0.3 : 0.5);
    const py = area.top + area.height * READING_LINE;
    for (const { doc } of renderer.getContents()) {
      const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
      if (frame) markBlock(doc, blockAt(doc, px - frame.left, py - frame.top));
    }
  });

  /* Turning it on or off, or new colours, restyles every section on screen. */
  useEffect(() => {
    const renderer = openRef.current ? viewRef.current?.renderer : null;
    if (!renderer) return;
    pinnedRef.current = false;
    for (const { doc } of renderer.getContents()) {
      if (spotlight) installSpotlight(doc, spotColors());
      else removeSpotlight(doc);
    }
    refreshSpot();
  }, [spotlight, theme]);

  const applyStyles = useEffectEvent(() => {
    const renderer = viewRef.current?.renderer;
    const host = hostRef.current;
    if (renderer && host) renderer.setStyles(readingCss(host, pagedRef.current, font));
  });

  /* Foliate re-lays out the open section and returns to the passage that was in view. */
  const applyMode = useEffectEvent((paged: boolean) => {
    const renderer = viewRef.current?.renderer;
    const host = hostRef.current;
    if (!renderer || !host) return;
    pagedRef.current = paged;
    if (paged) setAtSectionEnd(false);
    applyStyles();
    fitColumns(renderer, host.clientWidth);
    renderer.setAttribute("flow", paged ? "paginated" : "scrolled");
  });

  useEffect(() => {
    if (openRef.current) applyMode(mode === "pages");
  }, [mode]);

  /* New colours or a new font: foliate lays the section out again and returns to the passage that was in view. */
  useEffect(() => {
    if (openRef.current) applyStyles();
  }, [theme, font]);

  /* Marking keeps foliate's place, a live range, on the same words, so laying out again returns to it the way
     a change of colours or font does. Highlights are drawn again from their CFIs, since a range can shift
     within a word. */
  useEffect(() => {
    const view = openRef.current ? viewRef.current : null;
    if (!view) return;
    for (const { doc } of view.renderer.getContents()) {
      if (boldStarts) addFixations(doc);
      else removeFixations(doc);
    }
    drawHighlights();
    view.renderer.render();
  }, [boldStarts]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let view: FoliateView | null = null;
    let pointerDown = false;
    let overscroll = 0;
    let lastWheel = 0;
    let turning = false;
    let frame = 0;
    let settle = 0;
    const columns = new ResizeObserver(() => {
      const renderer = openRef.current ? view?.renderer : null;
      if (renderer && fitColumns(renderer, host.clientWidth) && pagedRef.current) renderer.render();
      /* The sections lay out again after a resize, which moves the text under the reading line. */
      clearTimeout(settle);
      settle = window.setTimeout(refreshSpot, 300);
    });

    const isLastSection = () => {
      const section = sectionRef.current;
      return !view || !section || !view.book.sections.slice(section.index + 1).some((s) => s.linear !== "no");
    };

    const updateEdge = () => {
      const renderer = view?.renderer;
      setAtSectionEnd(!pagedRef.current && !!renderer && renderer.end >= renderer.viewSize - 2 && !isLastSection());
    };

    const turn = (direction: 1 | -1) => {
      const renderer = view?.renderer;
      if (!renderer || turning) return;
      turning = true;
      overscroll = 0;
      (direction === 1 ? renderer.next() : renderer.prev()).finally(() => {
        turning = false;
      });
    };
    turnRef.current = turn;

    /* Scroll mode shows one section at a time; keep scrolling past an edge to turn. */
    const onWheel = (event: WheelEvent) => {
      pinnedRef.current = false;
      emitInteract();
      const renderer = view?.renderer;
      if (!renderer || turning || pagedRef.current) return;
      const now = performance.now();
      if (now - lastWheel > GESTURE_GAP_MS) overscroll = 0;
      lastWheel = now;
      const pastEnd = event.deltaY > 0 && renderer.end >= renderer.viewSize - 2;
      const pastStart = event.deltaY < 0 && renderer.start <= 0;
      if (!pastEnd && !pastStart) {
        overscroll = 0;
        return;
      }
      overscroll += event.deltaY;
      if (Math.abs(overscroll) >= OVERSCROLL_TO_TURN) turn(overscroll > 0 ? 1 : -1);
    };

    const onScroll = () => {
      cancelAnimationFrame(frame);
      pinnedRef.current = false;
      frame = requestAnimationFrame(() => {
        emitSelectionRect();
        updateEdge();
        refreshSpot();
      });
    };

    const onLoad = (event: Event) => {
      const { doc, index } = (event as CustomEvent<{ doc: Document; index: number }>).detail;
      /* Before foliate lays the section out or resolves any CFI in it. */
      if (boldStartsNow()) addFixations(doc);
      if (spotlightNow()) installSpotlight(doc, spotColors());
      sectionRef.current = { doc, index };
      emitSelectionRect();
      doc.addEventListener("pointerdown", () => {
        pointerDown = true;
        /* A press in the book's frame counts as a press on the page, so open menus close. */
        host.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      });
      doc.addEventListener("pointerup", (e) => {
        pointerDown = false;
        setTimeout(emitSelectionRect, 0);
        /* In the spotlight, a click or a selection puts the light on that paragraph. */
        if (spotlightNow()) {
          const range = selectedRange(doc);
          const block = range ? blockOf(range.startContainer) : blockOf(e.target as Node | null);
          if (block) {
            pinnedRef.current = true;
            markBlock(doc, block);
          }
        }
      });
      doc.addEventListener("keyup", (e) => {
        if (e.shiftKey || e.key === "Shift") emitSelectionRect();
      });
      doc.addEventListener("selectionchange", () => {
        if (!pointerDown && !selectedRange(doc)) emitSelectionRect();
      });
      doc.addEventListener("keydown", (e) => {
        if (NAV_KEYS.has(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
          pinnedRef.current = false;
          emitInteract();
        }
        /* Keys pressed while the book's frame has focus reach the page's shortcuts too. Esc included: the page
           clears the selection itself, so it can tell whether that Esc had a selection to clear. */
        const { key, code, metaKey, ctrlKey, shiftKey, altKey, repeat } = e;
        const forwarded = new KeyboardEvent("keydown", { key, code, metaKey, ctrlKey, shiftKey, altKey, repeat, bubbles: true, cancelable: true });
        if (!host.dispatchEvent(forwarded)) e.preventDefault();
      });
      doc.addEventListener("wheel", onWheel, { passive: true });
      doc.addEventListener("touchmove", () => emitInteract(), { passive: true });
      refreshSpot();
    };

    const onRelocate = (event: Event) => {
      const detail = (event as CustomEvent<RelocateDetail>).detail;
      const { cfi, fraction, tocItem, section } = detail;
      const renderer = view?.renderer;
      const current = sectionRef.current;
      const whole = renderer && section && wholeChaptersRef.current.has(section.current);
      const left = whole ? leftInSection(renderer, current?.index === section.current ? current.doc : null, pagedRef.current) : null;
      emitPosition(
        { kind: "epub", cfi, fraction: fraction ?? 0 },
        {
          chapter: (tocItem && tocRef.current.get(tocItem)) ?? null,
          page: pageNumber(detail),
          pagesLeftInChapter: left?.pages ?? null,
          minutesLeftInChapter: left?.minutes ?? null,
        },
      );
      updateEdge();
      refreshSpot();
    };

    (async () => {
      const [, { Overlayer }] = await Promise.all([
        import(/* webpackIgnore: true */ FOLIATE_VIEW),
        import(/* webpackIgnore: true */ FOLIATE_OVERLAYER) as Promise<OverlayerModule>,
      ]);
      if (disposed) return;
      /* One warm tint per line, the token's own alpha, with softened corners. */
      const tint = (rects: Iterable<Box>) => {
        const group = Overlayer.highlight(mergeLineBoxes(rects));
        group.style.fill = "var(--color-highlight)";
        group.style.opacity = "1";
        for (const rect of Array.from(group.children)) rect.setAttribute("rx", "2");
        return group;
      };
      /* A new highlight gets a second coat that fades to the normal tint, the same glow the panel uses. The
         overlay lives in foliate's shadow DOM, out of reach of the stylesheet's classes, so it plays through
         the Web Animations API with the stylesheet's timing. foliate redraws a highlight whenever the page
         lays out again, which happens right after one is made, so each redraw picks the glow up where it had
         got to, and once it is over the highlight draws plain. */
      const tintFor = (cfi: string) => (rects: Iterable<Box>) => {
        const group = tint(rects);
        const started = glowsRef.current.get(cfi);
        if (started === undefined) return group;
        const now = performance.now();
        const delay = tokenMs("--glow-delay");
        const duration = tokenMs("--glow-duration");
        const elapsed = Number.isNaN(started) ? 0 : now - started;
        if (Number.isNaN(started)) glowsRef.current.set(cfi, now);
        if (elapsed >= delay + duration) {
          glowsRef.current.delete(cfi);
          return group;
        }
        const coat = tint(rects);
        group.append(coat);
        const easing = getComputedStyle(document.documentElement).getPropertyValue("--ease-out").trim() || "ease-out";
        const glow = coat.animate([{ opacity: 1 }, { opacity: 0 }], { duration, delay, easing, fill: "both" });
        glow.currentTime = elapsed;
        glow.onfinish = () => coat.remove();
        return group;
      };
      const onShowAnnotation = (event: Event) => {
        const { value, range } = (event as CustomEvent<{ value: string; range: Range }>).detail;
        const doc = range.startContainer.ownerDocument;
        /* A drag that starts on a highlight also ends in a click; selecting wins. */
        if (!doc || selectedRange(doc)) return;
        const hit = [...highlightsRef.current.values()].find((h) => h.anchor.kind === "epub" && h.anchor.cfi === value);
        const rect = viewportRect(range, doc.defaultView?.frameElement);
        if (hit && rect) emitHighlightClick(hit.id, rect);
      };
      view = document.createElement("foliate-view") as FoliateView;
      view.className = "block size-full";
      view.cfiFilter = skipFixations;
      view.addEventListener("load", onLoad);
      view.addEventListener("relocate", onRelocate);
      view.addEventListener("wheel", onWheel, { passive: true });
      view.addEventListener("draw-annotation", (event) => {
        const detail = (event as CustomEvent<DrawDetail>).detail;
        detail.draw(glowsRef.current.has(detail.annotation.value) ? tintFor(detail.annotation.value) : tint);
      });
      view.addEventListener("create-overlay", drawHighlights);
      view.addEventListener("show-annotation", onShowAnnotation);
      host.append(view);
      viewRef.current = view;
      await view.open(`/api/books/${bookId}/file`);
      if (disposed) return;
      openRef.current = true;
      const { renderer } = view;
      renderer.setAttribute("max-inline-size", COLUMN_WIDTH);
      applyMode(modeNow() === "pages");
      renderer.addEventListener("scroll", onScroll);
      columns.observe(host);
      const { metadata, toc, sections } = view.book;
      tocRef.current = epubToc(toc);
      const entries = [...tocRef.current.values()].flatMap(({ depth, target }) => {
        const section = target.kind === "epub" ? view?.resolveNavigation(target.href)?.index : undefined;
        return section !== undefined && section >= 0 ? [{ depth, section }] : [];
      });
      wholeChaptersRef.current = wholeChapterSections(entries, sections.map((s) => s.linear !== "no"));
      emitReady({ title: metaText(metadata?.title), author: metaText(metadata?.author), toc: [...tocRef.current.values()] });
      await view.init({ lastLocation: initialCfi(), showTextStart: true });
    })().catch((error: unknown) => {
      if (!disposed) emitError(openFailure("epub", error));
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      columns.disconnect();
      view?.close();
      view?.remove();
      viewRef.current = null;
      turnRef.current = null;
      openRef.current = false;
      sectionRef.current = null;
    };
  }, [bookId]);

  return (
    <div className="relative size-full bg-page">
      <div ref={hostRef} className="size-full" />
      {atSectionEnd ? (
        <button
          type="button"
          onClick={() => {
            onInteract?.();
            turnRef.current?.(1);
          }}
          className="press animate-rise absolute bottom-6 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full bg-panel-raised px-3.5 text-label font-medium text-fog shadow-float transition-colors duration-[var(--duration-fast)] hover:bg-panel-hover hover:text-paper"
        >
          Next chapter
          <ArrowDown className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
