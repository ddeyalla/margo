import type { SelectionRect } from "./types";

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "dd", "div", "dl", "dt", "figcaption", "figure", "footer",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "ol", "p", "pre", "section", "table", "td",
  "th", "tr", "ul",
]);

/** Whether a node sits inside a <pre>, where line breaks in the source are real. */
export const insidePre = (node: Node): boolean =>
  !!(node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)?.closest("pre");

/**
 * Text of a node or fragment with a blank line at block edges, so paragraphs
 * don't run together. Line breaks in the HTML source read as spaces, the way
 * the page shows them, except inside <pre>. Pass `pre` when the whole
 * fragment was cut from inside one.
 */
export const blockText = (root: Node, pre = false): string => {
  let out = "";
  const walk = (node: Node, inPre: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue ?? "";
      out += inPre ? text : text.replace(/[ \t\n\r\f]+/g, " ");
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as Element).localName;
      if (tag === "script" || tag === "style") return;
      if (tag === "br") {
        out += "\n";
        return;
      }
      const block = BLOCK_TAGS.has(tag);
      if (block) out += "\n\n";
      node.childNodes.forEach((child) => walk(child, inPre || tag === "pre"));
      if (block) out += "\n\n";
      return;
    }
    node.childNodes.forEach((child) => walk(child, inPre));
  };
  walk(root, pre);
  return out;
};

/** The text from the start of `root` up to the range, and from the range to the end of `root`. */
export const textAround = (range: Range, root: Node): { before: string; after: string } => {
  const doc = root.ownerDocument ?? (root as Document);
  const head = doc.createRange();
  head.setStart(root, 0);
  head.setEnd(range.startContainer, range.startOffset);
  const tail = doc.createRange();
  tail.setStart(range.endContainer, range.endOffset);
  tail.setEnd(root, root.childNodes.length);
  return { before: blockText(head.cloneContents()), after: blockText(tail.cloneContents()) };
};

/** The range's bounding box in the top window's viewport, shifted by the frame it lives in. */
export const viewportRect = (range: Range, frame?: Element | null): SelectionRect | null => {
  const box = range.getBoundingClientRect();
  if (!box.width && !box.height) return null;
  const offset = frame?.getBoundingClientRect();
  return {
    top: box.top + (offset?.top ?? 0),
    left: box.left + (offset?.left ?? 0),
    width: box.width,
    height: box.height,
  };
};

/** The live, non-empty selection range in a document, if any. */
export const selectedRange = (doc: Document): Range | null => {
  const selection = doc.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return range.toString().trim() ? range : null;
};
