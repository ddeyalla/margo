"use client";

import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { normalizeText, trimAfter, trimBefore } from "@/lib/shared/context";
import type { Highlight, SelectionContext } from "@/lib/shared/types";
import { blockText, insidePre, selectedRange, textAround, viewportRect } from "./dom";
import { openFailure } from "./errors";
import { mergeLineBoxes, type Box } from "./rects";
import { epubToc, type FoliateTocItem } from "./toc";
import type { ReaderProps, TocEntry } from "./types";

/* foliate-js ships no types. These cover the parts this adapter uses. */
interface FoliateRenderer extends HTMLElement {
  start: number;
  end: number;
  viewSize: number;
  next(): Promise<void>;
  prev(): Promise<void>;
  setStyles(css: string): void;
}

interface FoliateView extends HTMLElement {
  book: { metadata?: { title?: unknown; author?: unknown }; sections: { linear?: string }[]; toc?: FoliateTocItem[] };
  renderer: FoliateRenderer;
  open(src: string): Promise<void>;
  init(options: { lastLocation: string | null; showTextStart: boolean }): Promise<void>;
  close(): void;
  goTo(target: string): Promise<unknown>;
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
}

interface RelocateDetail {
  cfi: string;
  fraction?: number;
  tocItem?: FoliateTocItem | null;
}

/** Served from public/ and imported at runtime, never bundled. */
const FOLIATE_VIEW = "/vendor/foliate-js/view.js";
const FOLIATE_OVERLAYER = "/vendor/foliate-js/overlayer.js";
/** Wheel distance past a section's edge that turns to the next or previous section. */
const OVERSCROLL_TO_TURN = 260;
/** Wheel events further apart than this start a new overscroll gesture. */
const GESTURE_GAP_MS = 400;
/** Book text column width: about 66 characters of Literata at 18px. */
const COLUMN_WIDTH = "570px";

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
    URLs are resolved against their own stylesheet, since a blob document has no usable base. */
const pageFontFaces = (): string => {
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

const readingCss = (literata: string) => `
${pageFontFaces()}
html { color-scheme: dark; }
html, body { background: transparent !important; }
body {
  color: #d6d6da !important;
  font-family: ${literata}, Georgia, serif !important;
  font-size: 18px !important;
  line-height: 1.7 !important;
  padding: 56px 0 160px !important;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
body * { color: inherit !important; background-color: transparent !important; border-color: rgba(255, 255, 255, 0.1) !important; }
body *:not(pre, pre *, code, kbd, samp) { font-family: inherit !important; }
p, li, blockquote, dd, dt { line-height: 1.7 !important; }
p { hyphens: auto; }
h1, h2, h3, h4, h5, h6 { color: #ededf0 !important; line-height: 1.3 !important; letter-spacing: -0.01em; }
a { text-decoration-color: rgba(214, 214, 218, 0.35) !important; text-underline-offset: 3px; }
pre, code, kbd, samp { font-family: "JetBrains Mono", ui-monospace, Menlo, monospace !important; font-size: 0.82em !important; }
pre { background-color: rgba(255, 255, 255, 0.04) !important; padding: 0.9em 1.1em !important; border-radius: 8px; white-space: pre-wrap !important; line-height: 1.55 !important; }
img { background-color: #ececef !important; border-radius: 4px; }
hr { border: 0 !important; height: 1px; background-color: rgba(255, 255, 255, 0.1) !important; }
::selection { background: rgba(59, 130, 246, 0.32); }
`;

export function EpubReader({
  ref,
  bookId,
  initialPosition,
  onReady,
  onSelectionChange,
  onPositionChange,
  onError,
  onHighlightClick,
}: ReaderProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  /* Set once the book is open, when foliate can resolve a CFI to a section. */
  const openRef = useRef(false);
  /* Every highlight, drawn again into each section's overlay as foliate creates it. */
  const highlightsRef = useRef(new Map<string, Highlight>());
  const sectionRef = useRef<{ doc: Document; index: number } | null>(null);
  /* The book's table of contents, keyed by the foliate item each entry came from. */
  const tocRef = useRef(new Map<FoliateTocItem, TocEntry>());
  const [atSectionEnd, setAtSectionEnd] = useState(false);

  const chapterOf = (item: FoliateTocItem | null | undefined) => (item && tocRef.current.get(item)) ?? null;

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
    showHighlight(highlight) {
      highlightsRef.current.set(highlight.id, highlight);
      if (openRef.current && highlight.anchor.kind === "epub") {
        viewRef.current?.addAnnotation({ value: highlight.anchor.cfi }).catch(() => undefined);
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

    const isLastSection = () => {
      const section = sectionRef.current;
      return !view || !section || !view.book.sections.slice(section.index + 1).some((s) => s.linear !== "no");
    };

    const updateEdge = () => {
      const renderer = view?.renderer;
      setAtSectionEnd(!!renderer && renderer.end >= renderer.viewSize - 2 && !isLastSection());
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

    /* Scrolled mode shows one section at a time; keep scrolling past an edge to turn. */
    const onWheel = (event: WheelEvent) => {
      const renderer = view?.renderer;
      if (!renderer || turning) return;
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
      frame = requestAnimationFrame(() => {
        emitSelectionRect();
        updateEdge();
      });
    };

    const onLoad = (event: Event) => {
      const { doc, index } = (event as CustomEvent<{ doc: Document; index: number }>).detail;
      sectionRef.current = { doc, index };
      emitSelectionRect();
      doc.addEventListener("pointerdown", () => {
        pointerDown = true;
        /* A press in the book's frame counts as a press on the page, so open menus close. */
        host.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      });
      doc.addEventListener("pointerup", () => {
        pointerDown = false;
        setTimeout(emitSelectionRect, 0);
      });
      doc.addEventListener("keyup", (e) => {
        if (e.shiftKey || e.key === "Shift") emitSelectionRect();
      });
      doc.addEventListener("selectionchange", () => {
        if (!pointerDown && !selectedRange(doc)) emitSelectionRect();
      });
      doc.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          doc.getSelection()?.removeAllRanges();
          emitSelectionRect();
        }
        /* Keys pressed while the book's frame has focus reach the page's shortcuts too. */
        const { key, code, metaKey, ctrlKey, shiftKey, altKey, repeat } = e;
        const forwarded = new KeyboardEvent("keydown", { key, code, metaKey, ctrlKey, shiftKey, altKey, repeat, bubbles: true, cancelable: true });
        if (!host.dispatchEvent(forwarded)) e.preventDefault();
      });
      doc.addEventListener("wheel", onWheel, { passive: true });
    };

    const onRelocate = (event: Event) => {
      const { cfi, fraction, tocItem } = (event as CustomEvent<RelocateDetail>).detail;
      emitPosition({ kind: "epub", cfi, fraction: fraction ?? 0 }, (tocItem && tocRef.current.get(tocItem)) ?? null);
      updateEdge();
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
      const onCreateOverlay = () => {
        for (const { anchor } of highlightsRef.current.values()) {
          if (anchor.kind === "epub") view?.addAnnotation({ value: anchor.cfi }).catch(() => undefined);
        }
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
      view.addEventListener("load", onLoad);
      view.addEventListener("relocate", onRelocate);
      view.addEventListener("wheel", onWheel, { passive: true });
      view.addEventListener("draw-annotation", (event) => (event as CustomEvent<DrawDetail>).detail.draw(tint));
      view.addEventListener("create-overlay", onCreateOverlay);
      view.addEventListener("show-annotation", onShowAnnotation);
      host.append(view);
      viewRef.current = view;
      await view.open(`/api/books/${bookId}/file`);
      if (disposed) return;
      openRef.current = true;
      const { renderer } = view;
      renderer.setAttribute("flow", "scrolled");
      renderer.setAttribute("max-inline-size", COLUMN_WIDTH);
      const literata = getComputedStyle(document.documentElement).getPropertyValue("--font-literata").trim() || "Literata";
      renderer.setStyles(readingCss(literata));
      renderer.addEventListener("scroll", onScroll);
      const { metadata, toc } = view.book;
      tocRef.current = epubToc(toc);
      emitReady({ title: metaText(metadata?.title), author: metaText(metadata?.author), toc: [...tocRef.current.values()], pageCount: null });
      await view.init({ lastLocation: initialCfi(), showTextStart: true });
    })().catch((error: unknown) => {
      if (!disposed) emitError(openFailure("epub", error));
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      view?.close();
      view?.remove();
      viewRef.current = null;
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
          onClick={() => viewRef.current?.renderer.next()}
          className="press animate-rise absolute bottom-6 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full bg-panel-raised px-3.5 text-label font-medium text-fog shadow-float transition-colors duration-[var(--duration-fast)] hover:bg-panel-hover hover:text-paper"
        >
          Next chapter
          <ArrowDown className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
