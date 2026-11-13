"use client";

import { useEffect, useEffectEvent, useImperativeHandle, useRef } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask, TextLayer } from "pdfjs-dist";
import { normalizeText, trimAfter, trimBefore } from "@/lib/shared/context";
import type { Position, SelectionContext } from "@/lib/shared/types";
import { blockText, selectedRange, viewportRect } from "./dom";
import { PDFJS_ASSETS, chapterAt, flowText, loadPdfJs, offsetInLayer, pageText, readOutline, type OutlineEntry } from "./pdf";
import type { ReaderProps } from "./types";

/** Widest a page is drawn, so wide windows don't blow pages up past comfortable reading. */
const MAX_PAGE_WIDTH = 960;
/** Space kept on each side of the page column. */
const GUTTER = 32;
/** Pages within two screens of the viewport are drawn; the rest are released. */
const RENDER_MARGIN = "200% 0px";

type PdfPosition = Extract<Position, { kind: "pdf" }>;

interface Slot {
  page: number;
  el: HTMLDivElement;
  /** Height over width, once the page has been measured. */
  ratio: number | null;
  /** Bumped on every release so a stale render stops. */
  generation: number;
  task: RenderTask | null;
  textLayer: TextLayer | null;
}

interface Engine {
  slots: Slot[];
  texts: Map<number, string>;
  outline: OutlineEntry[];
}

/** PDF info titles are often a source filename; those are worse than our cleaned file title. */
const usableTitle = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const title = value.trim();
  return title.length > 2 && !/\.(docx?|indd|pdf|qxd|tex)$|^untitled$/i.test(title) ? title : null;
};

const isCancelled = (error: unknown) =>
  error instanceof Error && (error.name === "RenderingCancelledException" || error.name === "AbortException");

export function PdfReader({ ref, bookId, initialPosition, onReady, onSelectionChange, onPositionChange, onError }: ReaderProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine>({ slots: [], texts: new Map(), outline: [] });

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
    const page = Number(startLayer.dataset.page);
    const text = texts.get(page) ?? "";
    const endLayer = layerOf(range.endContainer);
    const endPage = endLayer ? Number(endLayer.dataset.page) : page;
    const start = offsetInLayer(startLayer, range.startContainer, range.startOffset);
    const endText = texts.get(endPage) ?? "";
    const endInEndPage = endLayer ? offsetInLayer(endLayer, range.endContainer, range.endOffset) : endText.length;
    return {
      text: normalizeText(flowText(blockText(range.cloneContents()))),
      before: trimBefore(flowText((texts.get(page - 1) ?? "") + "\n" + text.slice(0, start))),
      after: trimAfter(flowText(endText.slice(endInEndPage) + "\n" + (texts.get(endPage + 1) ?? ""))),
      anchor: { kind: "pdf", page, start, end: endPage === page ? endInEndPage : text.length },
      chapterTitle: chapterAt(outline, page),
      rect,
    };
  };

  useImperativeHandle(ref, () => ({
    getSelection: readSelection,
    clearSelection() {
      if (ownRange()) document.getSelection()?.removeAllRanges();
      onSelectionChange(null);
    },
    async goTo(anchor) {
      const scroller = scrollRef.current;
      const slot = anchor.kind === "pdf" ? engineRef.current.slots[anchor.page - 1] : null;
      if (!scroller || !slot || anchor.kind !== "pdf") return;
      const length = engineRef.current.texts.get(anchor.page)?.length;
      const within = length ? (anchor.start / length) * slot.el.offsetHeight : 0;
      scroller.scrollTo({ top: Math.max(0, slot.el.offsetTop + within - scroller.clientHeight / 3), behavior: "smooth" });
    },
  }));

  const emitSelectionRect = useEffectEvent(() => {
    const range = ownRange();
    onSelectionChange(range ? viewportRect(range) : null);
  });
  const emitReady = useEffectEvent(onReady);
  const emitPosition = useEffectEvent(onPositionChange);
  const emitError = useEffectEvent(onError);
  const startPosition = useEffectEvent(() => (initialPosition?.kind === "pdf" ? initialPosition : null));

  useEffect(() => {
    const scroller = scrollRef.current;
    const column = columnRef.current;
    if (!scroller || !column) return;
    const engine: Engine = { slots: [], texts: new Map(), outline: [] };
    engineRef.current = engine;
    const { slots, texts } = engine;
    let disposed = false;
    let loading: PDFDocumentLoadingTask | null = null;
    let doc: PDFDocumentProxy | null = null;
    let observer: IntersectionObserver | null = null;
    let resizer: ResizeObserver | null = null;
    let width = 0;
    let baseRatio = Math.SQRT2;
    let frame = 0;
    let resizeTimer = 0;
    let pointerDown = false;

    const fitWidth = () => Math.max(240, Math.min(MAX_PAGE_WIDTH, scroller.clientWidth - GUTTER * 2));

    const sizeSlot = (slot: Slot) => {
      slot.el.style.width = `${width}px`;
      slot.el.style.height = `${Math.round(width * (slot.ratio ?? baseRatio))}px`;
    };

    const release = (slot: Slot) => {
      slot.generation += 1;
      slot.task?.cancel();
      slot.textLayer?.cancel();
      slot.task = null;
      slot.textLayer = null;
      slot.el.replaceChildren();
      delete slot.el.dataset.rendered;
    };

    const render = async (slot: Slot) => {
      if (!doc || slot.el.dataset.rendered) return;
      const generation = ++slot.generation;
      slot.el.dataset.rendered = "true";
      try {
        const pdfjs = await loadPdfJs();
        const page = await doc.getPage(slot.page);
        if (generation !== slot.generation) return;
        const unscaled = page.getViewport({ scale: 1 });
        slot.ratio = unscaled.height / unscaled.width;
        sizeSlot(slot);
        const viewport = page.getViewport({ scale: width / unscaled.width });
        const pixelRatio = window.devicePixelRatio || 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        const layer = document.createElement("div");
        layer.className = "textLayer";
        layer.dataset.page = String(slot.page);
        slot.el.style.setProperty("--total-scale-factor", String(viewport.scale));
        slot.el.replaceChildren(canvas, layer);
        const task = page.render({ canvas, viewport, transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0] });
        /* A release can cancel this before it is awaited below; that rejection is expected. */
        task.promise.catch(() => undefined);
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
      } catch (error) {
        if (generation === slot.generation && !isCancelled(error)) delete slot.el.dataset.rendered;
      }
    };

    /** The slot at a vertical offset in the scroller, by binary search over page tops. */
    const slotAt = (y: number): Slot => {
      let low = 0;
      let high = slots.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (slots[mid].el.offsetTop <= y) low = mid;
        else high = mid - 1;
      }
      return slots[low];
    };

    const currentPosition = (): PdfPosition => {
      const top = scroller.scrollTop;
      const slot = slotAt(top + 1);
      const offset = Math.min(1, Math.max(0, (top - slot.el.offsetTop) / Math.max(1, slot.el.offsetHeight)));
      const max = scroller.scrollHeight - scroller.clientHeight;
      return { kind: "pdf", page: slot.page, offset, fraction: max > 0 ? Math.min(1, top / max) : 0 };
    };

    const restore = (position: { page: number; offset: number }) => {
      const slot = slots[Math.min(slots.length, Math.max(1, position.page)) - 1];
      if (slot) scroller.scrollTop = slot.el.offsetTop + position.offset * slot.el.offsetHeight;
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

    const relayout = () => {
      const next = fitWidth();
      if (!slots.length || Math.abs(next - width) < 1) return;
      const position = currentPosition();
      width = next;
      for (const slot of slots) {
        release(slot);
        sizeSlot(slot);
      }
      restore(position);
      observeAll();
    };

    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!slots.length) return;
        emitSelectionRect();
        const position = currentPosition();
        emitPosition(position, chapterAt(engine.outline, position.page));
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

    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    document.addEventListener("selectionchange", onSelectionChange);
    scroller.addEventListener("keyup", onKeyUp);

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
      for (let page = 1; page <= doc.numPages; page += 1) {
        const el = document.createElement("div");
        el.className = "pdf-page";
        el.dataset.page = String(page);
        const slot: Slot = { page, el, ratio: null, generation: 0, task: null, textLayer: null };
        sizeSlot(slot);
        slots.push(slot);
      }
      column.replaceChildren(...slots.map((slot) => slot.el));
      const start = startPosition();
      if (start) restore(start);
      observeAll();
      resizer = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(relayout, 120);
      });
      resizer.observe(scroller);

      const info = (await doc.getMetadata().catch(() => null))?.info as Record<string, unknown> | undefined;
      const author = usableTitle(info?.Author)?.split(/\s*;\s*/).filter(Boolean).join(", ") || null;
      emitReady({ title: usableTitle(info?.Title), author });
      engine.outline = await readOutline(doc).catch(() => []);
      if (!disposed) onScroll();
    })().catch((error: unknown) => {
      if (disposed) return;
      emitError(
        error instanceof Error && error.name === "PasswordException"
          ? "This PDF is password protected."
          : error instanceof Error
            ? error.message
            : "This book could not be opened.",
      );
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      clearTimeout(resizeTimer);
      observer?.disconnect();
      resizer?.disconnect();
      for (const slot of slots) release(slot);
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("selectionchange", onSelectionChange);
      scroller.removeEventListener("keyup", onKeyUp);
      column.replaceChildren();
      void loading?.destroy();
    };
  }, [bookId]);

  return (
    <div ref={scrollRef} className="relative size-full overflow-y-auto bg-page">
      <div ref={columnRef} className="flex flex-col items-center gap-4 px-8 py-10" />
    </div>
  );
}
