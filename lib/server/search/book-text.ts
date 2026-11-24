import path from "node:path";
import { DOMParser, onErrorStopParsing, type Document as XmlDocument, type Element as XmlElement, type Node as XmlNode } from "@xmldom/xmldom";
import { unzipSync } from "fflate";
import { chapterAt, pageText, readOutline } from "@/components/reader/pdf";
import * as CFI from "@/public/vendor/foliate-js/epubcfi.js";
import type { Anchor } from "@/lib/shared/types";

/**
 * One run of a book's text with the place it starts: a paragraph or other block of an EPUB section, or a line
 * of a PDF page. `part` is the section or page, which no search chunk crosses.
 */
export interface TextBlock {
  anchor: Anchor;
  text: string;
  chapter: string | null;
  part: number;
}

const XHTML = "application/xhtml+xml";
const HTML = "text/html";

const isElement = (node: XmlNode): node is XmlElement => node.nodeType === 1;
const isText = (node: XmlNode) => node.nodeType === 3 || node.nodeType === 4;

const children = (node: XmlNode): XmlElement[] => Array.from(node.childNodes as ArrayLike<XmlNode>).filter(isElement);
const byName = (node: XmlNode, name: string): XmlElement[] => {
  const found: XmlElement[] = [];
  const visit = (current: XmlNode) => {
    for (const child of children(current)) {
      if (child.localName === name) found.push(child);
      visit(child);
    }
  };
  visit(node);
  return found;
};

/**
 * The browser DOM gives every element its `id` attribute as a property, and foliate's CFI code reads it for
 * the `[id]` assertions in the CFIs the reader makes. xmldom keeps it only as an attribute.
 */
const withIds = <T extends XmlDocument>(doc: T): T => {
  const visit = (node: XmlNode) => {
    for (const child of children(node)) {
      const id = child.getAttribute("id");
      if (id) (child as unknown as { id: string }).id = id;
      visit(child);
    }
  };
  visit(doc);
  return doc;
};

const parseXml = (text: string, mime: string): XmlDocument | null => {
  try {
    return withIds(new DOMParser({ onError: onErrorStopParsing }).parseFromString(text, mime));
  } catch {
    return null;
  }
};

/**
 * A section as the reader's foliate parses it: as XHTML, or as HTML when it is not valid XHTML or has no
 * namespace, as foliate's epub.js does. xmldom's HTML mode is not the browser's HTML parser, so anchors in a
 * section that needs it can land a block or so off; valid XHTML, nearly every book, gives the reader's CFIs.
 */
const parseSection = (text: string, mime: string): XmlDocument | null => {
  if (mime === XHTML) {
    const doc = parseXml(text, XHTML);
    if (doc?.documentElement?.namespaceURI) return doc;
  }
  try {
    return withIds(new DOMParser().parseFromString(text, HTML));
  } catch {
    return null;
  }
};

const decode = (bytes: Uint8Array | undefined) => (bytes ? new TextDecoder().decode(bytes) : null);

/** A manifest href as a path inside the archive, relative to the file that names it. */
const resolveHref = (from: string, href: string) => {
  const bare = href.split("#")[0];
  let decoded = bare;
  try {
    decoded = decodeURIComponent(bare);
  } catch {}
  return path.posix.normalize(path.posix.join(path.posix.dirname(from), decoded));
};

const fragmentOf = (href: string) => {
  const hash = href.indexOf("#");
  if (hash < 0) return null;
  try {
    return decodeURIComponent(href.slice(hash + 1)) || null;
  } catch {
    return href.slice(hash + 1) || null;
  }
};

const squash = (text: string) => text.replace(/[\s­]+/g, " ").trim();

/** Table of contents labels by file, each with the element id it starts at, or null for the top of the file. */
type TocMap = Map<string, { fragment: string | null; label: string }[]>;

const addToc = (toc: TocMap, file: string, href: string, label: string) => {
  const clean = squash(label);
  if (!clean) return;
  const target = resolveHref(file, href);
  const list = toc.get(target) ?? [];
  list.push({ fragment: fragmentOf(href), label: clean });
  toc.set(target, list);
};

/** The EPUB 3 navigation document's toc, else the EPUB 2 NCX. */
const readToc = (files: Record<string, Uint8Array>, nav: string | null, ncx: string | null): TocMap => {
  const toc: TocMap = new Map();
  const navDoc = nav && parseSection(decode(files[nav]) ?? "", XHTML);
  if (nav && navDoc) {
    const navs = byName(navDoc, "nav");
    const tocNav = navs.find((element) => /\btoc\b/.test(element.getAttributeNS("http://www.idpf.org/2007/ops", "type") ?? element.getAttribute("epub:type") ?? "")) ?? navs[0];
    for (const link of tocNav ? byName(tocNav, "a") : []) {
      const href = link.getAttribute("href");
      if (href) addToc(toc, nav, href, link.textContent ?? "");
    }
    if (toc.size) return toc;
  }
  const ncxDoc = ncx && parseXml(decode(files[ncx]) ?? "", "application/xml");
  if (ncx && ncxDoc) {
    for (const point of byName(ncxDoc, "navPoint")) {
      const src = children(point).find((child) => child.localName === "content")?.getAttribute("src");
      const label = children(point).find((child) => child.localName === "navLabel")?.textContent ?? "";
      if (src) addToc(toc, ncx, src, label);
    }
  }
  return toc;
};

/** Elements that start a block of their own. Text in anything else belongs to the nearest one around it. */
const BLOCKS = new Set([
  "address", "article", "aside", "blockquote", "body", "caption", "dd", "details", "div", "dl", "dt", "figcaption", "figure",
  "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "li", "main", "nav", "ol", "p", "pre", "section", "summary", "table",
  "td", "th", "tr", "ul",
]);
const SKIP = new Set(["head", "script", "style", "template", "noscript"]);

interface Block {
  first: XmlNode;
  offset: number;
  pieces: string[];
}

/** The section's blocks in document order, each with the first character of its text. */
const sectionBlocks = (doc: XmlDocument): { text: string; first: XmlNode; offset: number; ids: string[] }[] => {
  const blocks = new Map<XmlNode, Block>();
  /* Ids met since the last block began, so a table of contents entry that points at an anchor finds the block after it. */
  const idsBefore = new Map<XmlNode, string[]>();
  let pendingIds: string[] = [];
  const visit = (node: XmlNode, block: XmlNode) => {
    for (const child of Array.from(node.childNodes as ArrayLike<XmlNode>)) {
      if (isText(child)) {
        const value = child.nodeValue ?? "";
        const existing = blocks.get(block);
        if (existing) existing.pieces.push(value);
        else {
          const start = value.search(/\S/);
          if (start < 0) continue;
          blocks.set(block, { first: child, offset: start, pieces: [value] });
          idsBefore.set(block, pendingIds);
          pendingIds = [];
        }
      } else if (isElement(child)) {
        const name = child.localName ?? "";
        if (SKIP.has(name)) continue;
        const id = child.getAttribute("id");
        if (id) pendingIds.push(id);
        if (name === "br") blocks.get(block)?.pieces.push(" ");
        visit(child, BLOCKS.has(name) ? child : block);
      }
    }
  };
  if (doc.documentElement) visit(doc.documentElement, doc.documentElement);
  return [...blocks.entries()]
    .map(([key, block]) => ({ text: squash(block.pieces.join("")), first: block.first, offset: block.offset, ids: idsBefore.get(key) ?? [] }))
    .filter((block) => block.text);
};

/**
 * Every block of an EPUB's text, in reading order, with the CFI foliate would give the start of its text:
 * the spine item's step from the package document, then the path inside the section, made by foliate's own
 * CFI code. Chapters come from the table of contents; a section it doesn't name continues the one before.
 */
export const epubBlocks = (zip: Uint8Array): TextBlock[] => {
  const head = unzipSync(zip, { filter: (file) => file.name === "META-INF/container.xml" });
  const container = parseXml(decode(head["META-INF/container.xml"]) ?? "", "application/xml");
  const opfPath = container && byName(container, "rootfile")[0]?.getAttribute("full-path");
  if (!opfPath) throw new Error("No package document.");
  const opfFiles = unzipSync(zip, { filter: (file) => file.name === opfPath });
  const opf = parseXml(decode(opfFiles[opfPath]) ?? "", "application/xml");
  if (!opf) throw new Error("The package document can't be read.");

  const items = new Map<string, { file: string; mime: string; properties: string }>();
  for (const item of byName(opf, "item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) items.set(id, { file: resolveHref(opfPath, href), mime: item.getAttribute("media-type") ?? "", properties: item.getAttribute("properties") ?? "" });
  }
  const spine = byName(opf, "spine")[0];
  const itemrefs = spine ? children(spine).filter((child) => child.localName === "itemref") : [];
  if (!itemrefs.length) return [];
  const sectionCfis: string[] = CFI.fromElements(itemrefs);
  const nav = [...items.values()].find((item) => item.properties.split(/\s+/).includes("nav"))?.file ?? null;
  const ncxId = spine.getAttribute("toc");
  const ncx = (ncxId && items.get(ncxId)?.file) || ([...items.values()].find((item) => item.mime === "application/x-dtbncx+xml")?.file ?? null);

  const wanted = new Set([...itemrefs.map((ref) => items.get(ref.getAttribute("idref") ?? "")?.file), nav, ncx].filter((file): file is string => !!file));
  const files = unzipSync(zip, { filter: (file) => wanted.has(file.name) });
  const toc = readToc(files, nav, ncx);

  const blocks: TextBlock[] = [];
  let chapter: string | null = null;
  itemrefs.forEach((ref, index) => {
    const item = items.get(ref.getAttribute("idref") ?? "");
    if (!item || (item.mime !== XHTML && item.mime !== HTML)) return;
    const text = decode(files[item.file]);
    const doc = text && parseSection(text, item.mime);
    if (!doc) return;
    const entries = toc.get(item.file) ?? [];
    const top = entries.find((entry) => entry.fragment === null);
    if (top) chapter = top.label;
    else if (entries.length && !entries.some((entry) => entry.fragment && doc.getElementById(entry.fragment))) chapter = entries[0].label;
    const base = sectionCfis[index];
    for (const block of sectionBlocks(doc)) {
      const named = entries.filter((entry) => entry.fragment && block.ids.includes(entry.fragment));
      if (named.length) chapter = named[named.length - 1].label;
      const inner = CFI.fromRange({ startContainer: block.first, startOffset: block.offset, collapsed: true });
      blocks.push({ anchor: { kind: "epub", cfi: CFI.joinIndir(base, inner) }, text: block.text, chapter, part: index });
    }
  });
  return blocks;
};

/**
 * Every line of a PDF's text, page by page. Each anchor is the line's character range in the page text as
 * the reader's text layer counts it (`pageText`), so a jump lands on that line. Chapters come from the outline.
 */
export const pdfBlocks = async (data: Uint8Array): Promise<TextBlock[]> => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const assets = path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules/pdfjs-dist");
  const task = pdfjs.getDocument({
    data,
    standardFontDataUrl: `${assets}/standard_fonts/`,
    cMapUrl: `${assets}/cmaps/`,
    wasmUrl: `${assets}/wasm/`,
  });
  try {
    const doc = await task.promise;
    const outline = await readOutline(doc).catch(() => []);
    const blocks: TextBlock[] = [];
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const text = pageText(content);
      /* Where each line starts in the page text and how far down the page it sits, for its chapter. */
      const tops: number[] = [];
      let at = 0;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        if (tops.length === 0 || text[at - 1] === "\n") tops.push(Math.min(1, Math.max(0, viewport.convertToViewportPoint(item.transform[4], item.transform[5])[1] / viewport.height)));
        at += item.str.length + (item.hasEOL ? 1 : 0);
      }
      let start = 0;
      text.split("\n").forEach((line, row) => {
        const end = start + line.length;
        const clean = squash(line);
        if (clean) {
          const lead = line.search(/\S/);
          const trail = line.length - line.trimEnd().length;
          blocks.push({
            anchor: { kind: "pdf", page: number, start: start + lead, end: end - trail },
            text: clean,
            chapter: chapterAt(outline, number, tops[row] ?? 0)?.label ?? null,
            part: number,
          });
        }
        start = end + 1;
      });
      page.cleanup();
    }
    return blocks;
  } finally {
    await task.destroy();
  }
};
