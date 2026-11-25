"use client";

import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState } from "react";
import { ScanText, X } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask, TextLayer } from "pdfjs-dist";
import { normalizeText, trimAfter, trimBefore } from "@/lib/shared/context";
import { tailExcerpt } from "@/lib/shared/resume";
import { IconButton } from "@/components/ui";
import { samePassage } from "@/lib/shared/quotes";
import type { Anchor, Highlight, Position, SelectionContext } from "@/lib/shared/types";
import { blockText, selectedRange, viewportRect } from "./dom";
import { openFailure } from "./errors";
import {
  PDFJS_ASSETS,
  chapterAt,
  flowText,
  isLightPage,
  loadPdfJs,
  offsetInLayer,
  pageText,
  rangeInLayer,
  readOutline,
  samplePages,
  textPieces,
  type OutlineEntry,
} from "./pdf";
import { mergeLineBoxes, unionBox } from "./rects";
import type { ReaderProps } from "./types";

/** Widest a page is drawn, so wide windows don't blow pages up past comfortable reading. */
const MAX_PAGE_WIDTH = 960;
/** Space kept on each side of the page column. */
const GUTTER = 32;
/** Space kept above and below the page in Pages mode, where each page fits the pane's height. */
const PAGE_MARGIN = 20;
/** Space left above a chapter's heading when jumping to it. */
const ENTRY_MARGIN = 24;
/** Pages within two screens of the viewport are drawn; the rest are released. */
const RENDER_MARGIN = "200% 0px";

type PdfPosition = Extract<Position, { kind: "pdf" }>;

interface Slot {
  page: number;
  /** Holds the page. In Pages mode it is one screen tall with the page centred, and its top is where scrolling snaps. */
  sheet: HTMLDivElement;
  el: HTMLDivElement;
  /** Height over width, once the page has been measured. */
  ratio: number | null;
  /** The width the page is drawn at, in CSS pixels. */
  width: number;
  /** Bumped on every release so a stale render stops. */
  generation: number;
  /** The page being drawn, kept so a release can free what pdf.js holds for it. */
  proxy: PDFPageProxy | null;
  task: RenderTask | null;
  textLayer: TextLayer | null;
  /** The text layer has finished, so highlights can find their characters. */
  textReady: boolean;
}

interface Engine {
  slots: Slot[];
  texts: Map<number, string>;
  outline: OutlineEntry[];
  /** Whether pages are laid out one per screen, as the engine has them now. */
  isPaged(): boolean;
  /** Switches between one continuous column and one page per screen, keeping the page in view. */
  setPaged(paged: boolean): void;
  /** A page's text, read from the document when the page hasn't drawn yet, or null if it can't be. */
  textOf(page: number): Promise<string | null>;
}

const emptyEngine = (): Engine => ({
  slots: [],
  texts: new Map(),
  outline: [],
  isPaged: () => false,
  setPaged: () => undefined,
  textOf: async () => null,
});

/** Scroll position updates between page or chapter changes are sent at most this often; the resting position always is. */
const POSITION_THROTTLE_MS = 250;
/** How long finding a quoted passage waits for its page to give up its text. */
const TEXT_WAIT_MS = 3000;

/** Polls `read` until it gives a value or `ms` pass. */
const waitFor = async <T,>(read: () => T | undefined, ms: number): Promise<T | undefined> => {
  for (const end = Date.now() + ms; ; ) {
    const value = read();
    if (value !== undefined || Date.now() >= end) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};
/** A move within the page smaller than this share of it waits for the resting position. */
const POSITION_STEP = 0.01;

/** The slot whose sheet holds a vertical offset in the scroller, by binary search over sheet tops. */
const slotAt = (slots: Slot[], y: number): Slot => {
  let low = 0;
  let high = slots.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (slots[mid].sheet.offsetTop <= y) low = mid;
    else high = mid - 1;
  }
  return slots[low];
};

/** PDF info titles are often a source filename; those are worse than our cleaned file title. */
const usableTitle = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const title = value.trim();
  return title.length > 2 && !/\.(docx?|indd|pdf|qxd|tex)$|^untitled$/i.test(title) ? title : null;
};

const isCancelled = (error: unknown) =>
  error instanceof Error && (error.name === "RenderingCancelledException" || error.name === "AbortException");

const percent = (value: number, total: number) => `${(value / Math.max(1, total)) * 100}%`;

/** Pages checked for text before calling a PDF a scan. */
const SCAN_SAMPLES = 8;

/* One small canvas, reused, to read a rendered page's colours from. */
let sampler: CanvasRenderingContext2D | null = null;

/** "light" for a page of mostly white paper, which dark mode inverts; "dark" for anything else. */
const toneOf = (canvas: HTMLCanvasElement): "light" | "dark" => {
  sampler ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!sampler) return "dark";
  sampler.canvas.width = 24;
  sampler.canvas.height = 32;
  sampler.drawImage(canvas, 0, 0, 24, 32);
  return isLightPage(sampler.getImageData(0, 0, 24, 32).data) ? "light" : "dark";
};

/**
 * Draws a rendered page's highlights as tinted boxes between the canvas and
 * the text layer, by finding each one's characters in the text layer. Runs
 * again whenever the page renders, so highlights survive resizes and pages
 * that scroll out and back. A highlight in `made` glows the first time it is
 * drawn and leaves the set, so a later repaint doesn't glow it again.
 */
const paintPage = (slot: Slot | undefined, highlights: Map<string, Highlight>, made: Set<string>) => {
  const layer = slot?.textReady ? slot.el.querySelector(":scope > .textLayer") : null;
  const marks = slot?.el.querySelector(":scope > .pdf-marks");
  if (!slot || !layer || !marks) return;
  const page = slot.el.getBoundingClientRect();
  const drawn: HTMLElement[] = [];
  let pieces: ReturnType<typeof textPieces> | null = null;
  for (const highlight of highlights.values()) {
    const { anchor } = highlight;
    if (anchor.kind !== "pdf" || anchor.page !== slot.page) continue;
    pieces ??= textPieces(layer);
    const range = rangeInLayer(layer, anchor.start, anchor.end, pieces);
    const glow = made.delete(highlight.id);
    for (const box of range ? mergeLineBoxes(range.getClientRects()) : []) {
      const mark = document.createElement("div");
      mark.className = "pdf-mark";
      mark.dataset.id = highlight.id;
      mark.style.left = percent(box.left - page.left, page.width);
      mark.style.top = percent(box.top - page.top, page.height);
      mark.style.width = percent(box.width, page.width);
      mark.style.height = percent(box.height, page.height);
      if (glow) {
        const coat = document.createElement("span");
        coat.className = "pdf-mark-glow animate-glow";
        mark.append(coat);
      }
      drawn.push(mark);
    }
  }
  marks.replaceChildren(...drawn);
};

export function PdfReader({
  ref,
  bookId,
  initialPosition,
  mode,
  onReady,
  onSelectionChange,
  onPositionChange,
  onError,
  onHighlightClick,
  onInteract,
}: ReaderProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine>(emptyEngine());
  /* Outlives page renders and document loads: pages read it each time they draw. */
  const highlightsRef = useRef(new Map<string, Highlight>());
  const madeRef = useRef(new Set<string>());
  /* No sampled page has any text: the PDF is pictures of pages. */
  const [scanned, setScanned] = useState(false);

  /** The selection, if it lies inside this reader's pages. */
  const ownRange = (): Range | null => {
    const range = selectedRange(document);
    return range && scrollRef.current?.contains(range.commonAncestorContainer) ? range : null;
  };

  const readSelection = (): SelectionContext | null => {
    const range = ownRange();
    const rect = range && viewportRect(range);
    const layerOf = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(".textLayer");
    const startLayer = range && layerOf(range.startContainer);
    if (!range || !rect || !startLayer) return null;
    const { texts, outline } = engineRef.current;
    const endLayer = layerOf(range.endContainer) ?? startLayer;
    const startPage = Number(startLayer.dataset.page);
    const startOffset = offsetInLayer(startLayer, range.startContainer, range.startOffset);
    const endOffset = offsetInLayer(endLayer, range.endContainer, range.endOffset);
    /* An anchor lies on one page. A selection running across a page break keeps the page holding more of it,
       so a word or two at the foot of one page doesn't stand in for the sentence on the next.
       The quote and the words around it are cut at the same place as the anchor. */
    const crosses = endLayer !== startLayer;
    const onStartPage = (texts.get(startPage) ?? "").length - startOffset;
    const keepEnd = crosses && endOffset > onStartPage;
    const layer = keepEnd ? endLayer : startLayer;
    const page = Number(layer.dataset.page);
    const text = texts.get(page) ?? "";
    const start = keepEnd ? 0 : startOffset;
    const end = keepEnd || !crosses ? endOffset : text.length;
    const kept = range.cloneRange();
    if (keepEnd) kept.setStart(endLayer, 0);
    else if (crosses) kept.setEnd(startLayer, startLayer.childNodes.length);
    const pageBox = layer.getBoundingClientRect();
    const top = keepEnd ? 0 : (rect.top - pageBox.top) / Math.max(1, pageBox.height);
    return {
      text: normalizeText(flowText(blockText(kept.cloneContents()))),
      before: trimBefore(flowText((texts.get(page - 1) ?? "") + "\n" + text.slice(0, start))),
      after: trimAfter(flowText(text.slice(end) + "\n" + (texts.get(page + 1) ?? ""))),
      anchor: { kind: "pdf", page, start, end },
      chapterTitle: chapterAt(outline, page, top)?.label ?? null,
      rect,
    };
  };

  /* Showing or removing many highlights at once, as when a book opens, paints each page once on the next frame. */
  const dirtyPagesRef = useRef(new Set<number>());
  const paintFrameRef = useRef(0);
  const repaint = (page: number) => {
    dirtyPagesRef.current.add(page);
    if (paintFrameRef.current) return;
    paintFrameRef.current = requestAnimationFrame(() => {
      paintFrameRef.current = 0;
      const { slots } = engineRef.current;
      for (const dirty of dirtyPagesRef.current) paintPage(slots[dirty - 1], highlightsRef.current, madeRef.current);
      dirtyPagesRef.current.clear();
    });
  };
  useEffect(() => {
    const frame = paintFrameRef;
    const dirty = dirtyPagesRef.current;
    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      dirty.clear();
    };
  }, []);

  const goToAnchor = async (anchor: Anchor) => {
    const scroller = scrollRef.current;
    const slot = anchor.kind === "pdf" ? engineRef.current.slots[anchor.page - 1] : null;
    if (!scroller || !slot || anchor.kind !== "pdf") return;
    if (engineRef.current.isPaged()) {
      scroller.scrollTo({ top: slot.sheet.offsetTop, behavior: "smooth" });
      return;
    }
    /* A page far from the one shown hasn't drawn, so its text is read here to place the anchor within it. */
    const length = (await engineRef.current.textOf(anchor.page))?.length;
    const within = length ? (anchor.start / length) * slot.el.offsetHeight : 0;
    scroller.scrollTo({ top: Math.max(0, slot.el.offsetTop + within - scroller.clientHeight / 3), behavior: "smooth" });
  };

  useImperativeHandle(ref, () => ({
    getSelection: readSelection,
    clearSelection() {
      if (ownRange()) document.getSelection()?.removeAllRanges();
      onSelectionChange(null);
    },
    goTo: goToAnchor,
    async findPassage(anchor, text) {
      if (anchor.kind !== "pdf" || !engineRef.current.slots[anchor.page - 1]) return false;
      await goToAnchor(anchor);
      /* A page's text is read when the page first renders, which landing on it starts. */
      const pageText = await waitFor(() => engineRef.current.texts.get(anchor.page), TEXT_WAIT_MS);
      /* A page that never gave up its text can't be checked; the page is there, so take it as found. */
      return pageText === undefined || samePassage(pageText.slice(anchor.start, anchor.end), text);
    },
    async goToEntry(entry) {
      const scroller = scrollRef.current;
      const slot = entry.target.kind === "pdf" ? engineRef.current.slots[entry.target.page - 1] : null;
      if (!scroller || !slot || entry.target.kind !== "pdf") return;
      scroller.scrollTop = engineRef.current.isPaged()
        ? slot.sheet.offsetTop : Math.max(0, slot.el.offsetTop + entry.target.top * slot.el.offsetHeight - ENTRY_MARGIN);
    },
    turnPage(direction) {
      const scroller = scrollRef.current;
      const { slots } = engineRef.current;
      if (!scroller || !slots.length) return;
      const next = slots[slotAt(slots, scroller.scrollTop + scroller.clientHeight / 2).page - 1 + direction];
      /* A page turn lands at once, as a book page does; gliding there would slow every turn. */
      if (next) scroller.scrollTo({ top: next.sheet.offsetTop, behavior: "instant" });
    },
    seek(fraction) {
      const scroller = scrollRef.current;
      const { slots } = engineRef.current;
      if (!scroller || !slots.length) return;
      const top = fraction * (scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollTop = engineRef.current.isPaged() ? slotAt(slots, top + scroller.clientHeight / 2).sheet.offsetTop : top;
    },
    showHighlight(highlight, made) {
      highlightsRef.current.set(highlight.id, highlight);
      if (made) madeRef.current.add(highlight.id);
      if (highlight.anchor.kind === "pdf") repaint(highlight.anchor.page);
    },
    peek(position) {
      if (position.kind !== "pdf") return null;
      const { texts } = engineRef.current;
      const text = texts.get(position.page);
      if (!text) return null;
      const read = text.slice(0, Math.round(position.offset * text.length));
      const before = flowText((texts.get(position.page - 1) ?? "") + "\n" + read);
      const excerpt = tailExcerpt(normalizeText(flowText(read)));
      return excerpt ? { text: excerpt, before: trimBefore(before, 6000) } : null;
    },
    removeHighlight(id) {
      const highlight = highlightsRef.current.get(id);
      highlightsRef.current.delete(id);
      if (highlight?.anchor.kind === "pdf") repaint(highlight.anchor.page);
    },
  }));

  const emitSelectionRect = useEffectEvent(() => {
    const range = ownRange();
    onSelectionChange(range ? viewportRect(range) : null);
  });
  const emitReady = useEffectEvent(onReady);
  const emitPosition = useEffectEvent(onPositionChange);
  const emitError = useEffectEvent(onError);
  const emitHighlightClick = useEffectEvent(onHighlightClick);
  const startPosition = useEffectEvent(() => (initialPosition?.kind === "pdf" ? initialPosition : null));
  const pagedNow = useEffectEvent(() => mode === "pages");

  useEffect(() => {
    engineRef.current.setPaged(mode === "pages");
  }, [mode]);

  const emitInteract = useEffectEvent(() => onInteract?.());
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const interact = () => emitInteract();
    scroller.addEventListener("wheel", interact, { passive: true });
    scroller.addEventListener("touchmove", interact, { passive: true });
    return () => {
      scroller.removeEventListener("wheel", interact);
      scroller.removeEventListener("touchmove", interact);
    };
  }, []);

  useEffect(() => {
    const scroller = scrollRef.current;
    const column = columnRef.current;
    if (!scroller || !column) return;
    const engine = emptyEngine();
    engineRef.current = engine;
    const { slots, texts } = engine;
    let disposed = false;
    let loading: PDFDocumentLoadingTask | null = null;
    let doc: PDFDocumentProxy | null = null;
    let observer: IntersectionObserver | null = null;
    let resizer: ResizeObserver | null = null;
    let paged = pagedNow();
    /* The column's fitted width, and in Pages mode the pane height each page fits. */
    let width = 0;
    let height = 0;
    let baseRatio = Math.SQRT2;
    let frame = 0;
    let resizeTimer = 0;
    let pointerDown = false;

    const fitWidth = () => Math.max(240, Math.min(MAX_PAGE_WIDTH, scroller.clientWidth - GUTTER * 2));

    const sizeSlot = (slot: Slot) => {
      const ratio = slot.ratio ?? baseRatio;
      slot.width = paged ? Math.max(120, Math.min(width, Math.floor((height - PAGE_MARGIN * 2) / ratio))) : width;
      slot.el.style.width = `${slot.width}px`;
      slot.el.style.height = `${Math.round(slot.width * ratio)}px`;
      slot.sheet.style.height = paged ? `${height}px` : "";
    };

    const release = (slot: Slot) => {
      slot.generation += 1;
      slot.task?.cancel();
      slot.textLayer?.cancel();
      slot.task = null;
      slot.textLayer = null;
      slot.textReady = false;
      /* pdf.js frees the page's operator list and objects once its render has stopped. */
      slot.proxy?.cleanup();
      slot.proxy = null;
      /* A canvas's backing store can outlive the element; emptying it frees the memory now. */
      for (const canvas of slot.el.querySelectorAll("canvas")) {
        canvas.width = 0;
        canvas.height = 0;
      }
      slot.el.replaceChildren();
      delete slot.el.dataset.rendered;
      delete slot.el.dataset.tone;
    };

    const render = async (slot: Slot) => {
      if (!doc || slot.el.dataset.rendered) return;
      const generation = ++slot.generation;
      slot.el.dataset.rendered = "true";
      try {
        const pdfjs = await loadPdfJs();
        const page = await doc.getPage(slot.page);
        if (generation !== slot.generation) return;
        slot.proxy = page;
        const unscaled = page.getViewport({ scale: 1 });
        slot.ratio = unscaled.height / unscaled.width;
        sizeSlot(slot);
        const viewport = page.getViewport({ scale: slot.width / unscaled.width });
        const pixelRatio = window.devicePixelRatio || 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        const marks = document.createElement("div");
        marks.className = "pdf-marks";
        const layer = document.createElement("div");
        layer.className = "textLayer";
        layer.dataset.page = String(slot.page);
        slot.el.style.setProperty("--total-scale-factor", String(viewport.scale));
        slot.el.replaceChildren(canvas, marks, layer);
        const task = page.render({ canvas, viewport, transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0] });
        /* The page shows once painted, even if its text layer later fails. A release can cancel this; that rejection is expected. */
        task.promise.then(
          () => {
            if (generation === slot.generation) slot.el.dataset.tone = toneOf(canvas);
          },
          () => undefined,
        );
        slot.task = task;
        const content = await page.getTextContent();
        if (generation !== slot.generation) return;
        texts.set(slot.page, pageText(content));
        slot.textLayer = new pdfjs.TextLayer({ textContentSource: content, container: layer, viewport });
        await Promise.all([slot.task.promise, slot.textLayer.render()]);
        if (generation !== slot.generation) return;
        const endOfContent = document.createElement("div");
        endOfContent.className = "endOfContent";
        layer.append(endOfContent);
        slot.textReady = true;
        paintPage(slot, highlightsRef.current, madeRef.current);
      } catch (error) {
        if (generation === slot.generation && !isCancelled(error)) delete slot.el.dataset.rendered;
      }
    };

    /* Scroll mode reads the page at the top edge; Pages mode reads the page filling the screen. */
    const currentPosition = (): PdfPosition => {
      const top = scroller.scrollTop;
      const slot = slotAt(slots, paged ? top + scroller.clientHeight / 2 : top + 1);
      const offset = paged ? 0 : Math.min(1, Math.max(0, (top - slot.el.offsetTop) / Math.max(1, slot.el.offsetHeight)));
      const max = scroller.scrollHeight - scroller.clientHeight;
      return { kind: "pdf", page: slot.page, offset, fraction: max > 0 ? Math.min(1, top / max) : 0 };
    };

    const restore = (position: { page: number; offset: number }) => {
      const slot = slots[Math.min(slots.length, Math.max(1, position.page)) - 1];
      if (slot) scroller.scrollTop = paged ? slot.sheet.offsetTop : slot.el.offsetTop + position.offset * slot.el.offsetHeight;
    };

    const observeAll = () => {
      observer?.disconnect();
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const slot = slots[Number((entry.target as HTMLElement).dataset.page) - 1];
            if (entry.isIntersecting) void render(slot);
            else release(slot);
          }
        },
        { root: scroller, rootMargin: RENDER_MARGIN },
      );
      for (const slot of slots) observer.observe(slot.el);
    };

    /* Sizes every page for the pane and the mode, keeping the same page in view. The position is read before anything moves. */
    const relayout = (nextPaged = paged) => {
      const nextWidth = fitWidth();
      const nextHeight = scroller.clientHeight;
      const unchanged = nextPaged === paged && Math.abs(nextWidth - width) < 1 && (!paged || Math.abs(nextHeight - height) < 1);
      if (!slots.length || unchanged) {
        paged = nextPaged;
        return;
      }
      const position = currentPosition();
      paged = nextPaged;
      width = nextWidth;
      height = nextHeight;
      scroller.toggleAttribute("data-paged", paged);
      for (const slot of slots) {
        release(slot);
        sizeSlot(slot);
      }
      restore(position);
      observeAll();
    };
    engine.isPaged = () => paged;
    engine.setPaged = (next) => relayout(next);
    engine.textOf = async (page) => {
      const known = texts.get(page);
      if (known !== undefined || !doc) return known ?? null;
      try {
        return pageText(await (await doc.getPage(page)).getTextContent());
      } catch {
        return null;
      }
    };

    /* The last position sent, so scrolling within a page sends a few updates rather than one a frame. */
    let sent: { position: PdfPosition; chapter: OutlineEntry | null; at: number } | null = null;
    let restTimer = 0;
    const sendPosition = (resting: boolean) => {
      if (!slots.length) return;
      const position = currentPosition();
      /* Pages mode shows the whole page, so its chapter is the one in effect at the page's middle. */
      const chapter = chapterAt(engine.outline, position.page, paged ? 0.5 : position.offset);
      const now = performance.now();
      const last = sent?.position;
      const turned = !sent || last?.page !== position.page || sent.chapter !== chapter;
      const moved = !!last && Math.abs(position.offset - last.offset) > POSITION_STEP;
      const due = !!sent && now - sent.at >= POSITION_THROTTLE_MS;
      const changed = !last || last.page !== position.page || last.offset !== position.offset || last.fraction !== position.fraction;
      if (!turned && !(moved && due) && !(resting && changed)) return;
      sent = { position, chapter, at: now };
      emitPosition(position, {
        chapter,
        page: { kind: "pdf", page: position.page, total: slots.length },
        pagesLeftInChapter: null,
        minutesLeftInChapter: null,
      });
    };

    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!slots.length) return;
        emitSelectionRect();
        sendPosition(false);
        /* Once scrolling stops, the exact resting position is sent. */
        clearTimeout(restTimer);
        restTimer = window.setTimeout(() => sendPosition(true), POSITION_THROTTLE_MS);
      });
    };

    const onPointerDown = (event: PointerEvent) => {
      pointerDown = true;
      (event.target as Element).closest(".textLayer")?.classList.add("selecting");
    };
    const onPointerUp = () => {
      if (!pointerDown) return;
      pointerDown = false;
      for (const layer of scroller.querySelectorAll(".textLayer.selecting")) layer.classList.remove("selecting");
      setTimeout(emitSelectionRect, 0);
    };
    const onSelectionChange = () => {
      if (!pointerDown && !ownRange()) emitSelectionRect();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.shiftKey || event.key === "Shift") emitSelectionRect();
    };
    /* Highlight boxes sit under the text layer, so a click on one lands on text; match it by position. */
    const onClick = (event: MouseEvent) => {
      if (ownRange()) return;
      const page = (event.target as Element).closest(".pdf-page");
      const marks = page ? Array.from(page.querySelectorAll<HTMLElement>(".pdf-mark")) : [];
      const hit = marks.find((mark) => {
        const box = mark.getBoundingClientRect();
        return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      });
      const id = hit?.dataset.id;
      const box = id ? unionBox(marks.filter((mark) => mark.dataset.id === id).map((mark) => mark.getBoundingClientRect())) : null;
      if (id && box) emitHighlightClick(id, box);
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    document.addEventListener("selectionchange", onSelectionChange);
    scroller.addEventListener("keyup", onKeyUp);
    scroller.addEventListener("click", onClick);

    (async () => {
      const pdfjs = await loadPdfJs();
      if (disposed) return;
      loading = pdfjs.getDocument({
        url: `/api/books/${bookId}/file`,
        cMapUrl: `${PDFJS_ASSETS}/cmaps/`,
        iccUrl: `${PDFJS_ASSETS}/iccs/`,
        standardFontDataUrl: `${PDFJS_ASSETS}/standard_fonts/`,
        wasmUrl: `${PDFJS_ASSETS}/wasm/`,
      });
      doc = await loading.promise;
      if (disposed) return;
      const first = (await doc.getPage(1)).getViewport({ scale: 1 });
      baseRatio = first.height / first.width;
      width = fitWidth();
      height = scroller.clientHeight;
      scroller.toggleAttribute("data-paged", paged);
      for (let page = 1; page <= doc.numPages; page += 1) {
        const sheet = document.createElement("div");
        sheet.className = "pdf-sheet";
        const el = document.createElement("div");
        el.className = "pdf-page";
        el.dataset.page = String(page);
        sheet.append(el);
        const slot: Slot = { page, sheet, el, ratio: null, width, generation: 0, proxy: null, task: null, textLayer: null, textReady: false };
        sizeSlot(slot);
        slots.push(slot);
      }
      column.replaceChildren(...slots.map((slot) => slot.sheet));
      const start = startPosition();
      if (start) restore(start);
      observeAll();
      resizer = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => relayout(), 120);
      });
      resizer.observe(scroller);

      const info = (await doc.getMetadata().catch(() => null))?.info as Record<string, unknown> | undefined;
      const author = usableTitle(info?.Author)?.split(/\s*;\s*/).filter(Boolean).join(", ") || null;
      engine.outline = await readOutline(doc).catch(() => []);
      if (disposed) return;
      emitReady({ title: usableTitle(info?.Title), author, toc: engine.outline });
      onScroll();
      const loaded = doc;
      const pagesWithText = await Promise.all(
        samplePages(loaded.numPages, SCAN_SAMPLES).map((n) =>
          loaded
            .getPage(n)
            .then((page) => page.getTextContent())
            .then((content) => content.items.some((item) => "str" in item && item.str.trim() !== ""))
            .catch(() => true),
        ),
      );
      if (!disposed && !pagesWithText.some(Boolean)) setScanned(true);
    })().catch((error: unknown) => {
      if (!disposed) emitError(openFailure("pdf", error));
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      clearTimeout(restTimer);
      clearTimeout(resizeTimer);
      observer?.disconnect();
      resizer?.disconnect();
      for (const slot of slots) release(slot);
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("selectionchange", onSelectionChange);
      scroller.removeEventListener("keyup", onKeyUp);
      scroller.removeEventListener("click", onClick);
      column.replaceChildren();
      void loading?.destroy();
    };
  }, [bookId]);

  return (
    <div className="relative size-full">
      <div ref={scrollRef} className="pdf-scroller relative size-full overflow-y-auto overflow-x-hidden bg-page">
        <div ref={columnRef} className="pdf-column flex flex-col items-center gap-4 px-8 py-10" />
      </div>
      {scanned ? (
        <div
          role="status"
          className="animate-rise absolute bottom-5 left-1/2 flex w-max max-w-[min(460px,calc(100%-24px))] -translate-x-1/2 items-start gap-2.5 rounded-lg bg-panel-raised py-2.5 pl-3 pr-1.5 shadow-float"
        >
          <ScanText aria-hidden className="mt-0.5 size-4 shrink-0 text-fog" />
          <div className="min-w-0 py-px">
            <p className="text-body font-medium text-paper">This PDF has no selectable text</p>
            <p className="mt-0.5 text-label leading-relaxed text-dim">
              Its pages are scanned images. You can read it here, but highlights, notes and the tutor need text to select.
            </p>
          </div>
          <IconButton label="Dismiss" size="sm" onClick={() => setScanned(false)}>
            <X />
          </IconButton>
        </div>
      ) : null}
    </div>
  );
}
