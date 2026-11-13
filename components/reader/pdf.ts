import type { PageViewport, PDFDocumentProxy } from "pdfjs-dist";
import type { TextContent } from "pdfjs-dist/types/src/display/api";

/** pdf.js runtime assets, copied into public/ by scripts/copy-pdfjs-assets.mjs. */
export const PDFJS_ASSETS = "/vendor/pdfjs";

type PdfJs = typeof import("pdfjs-dist");
let pdfjs: Promise<PdfJs> | null = null;

export const loadPdfJs = (): Promise<PdfJs> =>
  (pdfjs ??= import("pdfjs-dist").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = `${PDFJS_ASSETS}/pdf.worker.min.mjs`;
    return lib;
  }));

/** A page's text exactly as its text layer lays it out: each item, then a line break where the item ends a line. */
export const pageText = (content: TextContent): string =>
  content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join("");

/** Joins a page's hard line breaks into running prose, rejoining words split by a hyphen. */
export const flowText = (text: string): string => text.replace(/(\w)-\n(\w)/g, "$1$2").replace(/\n/g, " ");

/** Character offset of a boundary point inside a text layer, counting text and one per line break. */
export const offsetInLayer = (layer: Element, node: Node, offset: number): number => {
  const range = layer.ownerDocument.createRange();
  range.setStart(layer, 0);
  range.setEnd(node, offset);
  let count = 0;
  const walker = layer.ownerDocument.createTreeWalker(range.cloneContents(), NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current.nodeType === Node.TEXT_NODE) count += current.nodeValue?.length ?? 0;
    else if ((current as Element).localName === "br") count += 1;
  }
  return count;
};

export interface OutlineEntry {
  page: number;
  /** Where the entry's destination sits on its page, as a fraction from the top. */
  top: number;
  title: string;
}

type OutlineItem = Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>[number];
type Destination = Awaited<ReturnType<PDFDocumentProxy["getDestination"]>>;

/** The destination's top edge in PDF units (y grows upward), or null when it names only the page. */
export const destinationTop = (dest: Destination): number | null => {
  if (!dest) return null;
  const kind = (dest[1] as { name?: string } | null)?.name;
  const value = kind === "XYZ" ? dest[3] : kind === "FitH" || kind === "FitBH" ? dest[2] : kind === "FitR" ? dest[5] : null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

/** The outline flattened to 1-based pages and in-page positions, in reading order, for finding a passage's chapter. */
export const readOutline = async (doc: PDFDocumentProxy): Promise<OutlineEntry[]> => {
  const outline = (await doc.getOutline()) ?? [];
  const entries: OutlineEntry[] = [];
  const viewports = new Map<number, Promise<PageViewport>>();
  const viewportOf = (index: number) => {
    if (!viewports.has(index)) viewports.set(index, doc.getPage(index + 1).then((page) => page.getViewport({ scale: 1 })));
    return viewports.get(index)!;
  };
  const visit = async (items: OutlineItem[]) => {
    for (const item of items) {
      try {
        const dest = typeof item.dest === "string" ? await doc.getDestination(item.dest) : item.dest;
        const ref = dest?.[0];
        const index = typeof ref === "number" ? ref : ref ? await doc.getPageIndex(ref) : null;
        if (index !== null && item.title.trim()) {
          const y = destinationTop(dest);
          const viewport = y === null ? null : await viewportOf(index);
          /* The viewport handles the crop box offset and page rotation. */
          const top = viewport && y !== null ? viewport.convertToViewportPoint(0, y)[1] / viewport.height : 0;
          entries.push({ page: index + 1, top: Math.min(1, Math.max(0, top)), title: item.title.trim() });
        }
      } catch {
        /* An outline entry with a broken destination is skipped. */
      }
      if (item.items?.length) await visit(item.items);
    }
  };
  await visit(outline);
  return entries.sort((a, b) => a.page - b.page || a.top - b.top);
};

/** A heading's destination can sit a little below the top of its own text. */
const HEADING_SLACK = 0.02;

/**
 * The chapter a point on a page belongs to: the last outline entry at or above
 * it, so a chapter that starts lower on the same page only covers what follows.
 */
export const chapterAt = (outline: OutlineEntry[], page: number, top: number): string | null => {
  let title: string | null = null;
  for (const entry of outline) {
    if (entry.page > page || (entry.page === page && entry.top > top + HEADING_SLACK)) break;
    title = entry.title;
  }
  return title;
};
