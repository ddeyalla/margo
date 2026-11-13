import type { PDFDocumentProxy } from "pdfjs-dist";
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
  title: string;
}

type OutlineItem = Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>[number];

/** The outline flattened to 1-based pages, sorted, for finding the chapter a page belongs to. */
export const readOutline = async (doc: PDFDocumentProxy): Promise<OutlineEntry[]> => {
  const outline = (await doc.getOutline()) ?? [];
  const entries: OutlineEntry[] = [];
  const visit = async (items: OutlineItem[]) => {
    for (const item of items) {
      try {
        const dest = typeof item.dest === "string" ? await doc.getDestination(item.dest) : item.dest;
        const ref = dest?.[0];
        const index = typeof ref === "number" ? ref : ref ? await doc.getPageIndex(ref) : null;
        if (index !== null && item.title.trim()) entries.push({ page: index + 1, title: item.title.trim() });
      } catch {
        /* An outline entry with a broken destination is skipped. */
      }
      if (item.items?.length) await visit(item.items);
    }
  };
  await visit(outline);
  return entries.sort((a, b) => a.page - b.page);
};

/** "Chapter title, p. 12", or "p. 12" when no outline entry covers the page. */
export const chapterAt = (outline: OutlineEntry[], page: number): string => {
  let title: string | null = null;
  for (const entry of outline) {
    if (entry.page > page) break;
    title = entry.title;
  }
  return title ? `${title}, p. ${page}` : `p. ${page}`;
};
