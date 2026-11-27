/**
 * The hover glance (a spike): with Option held, the word under the pointer is looked up in its sentence.
 * This finds that word and sentence in a section's document.
 */

export interface GlanceTarget {
  term: string;
  /** The sentence the word is in, for the meaning in context. */
  sentence: string;
  range: Range;
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

/** The word at a point of the page, with its sentence. Null over space, punctuation or an image. */
export const glanceAt = (doc: Document, x: number, y: number): GlanceTarget | null => {
  const caret = (doc as Document & { caretRangeFromPoint?(x: number, y: number): Range | null }).caretRangeFromPoint?.(x, y);
  const node = caret?.startContainer;
  if (!caret || !node || node.nodeType !== 3) return null;
  const text = node.nodeValue ?? "";
  const at = caret.startOffset;
  for (const match of text.matchAll(WORD)) {
    if (match.index > at) break;
    const end = match.index + match[0].length;
    if (at > end) continue;
    const range = doc.createRange();
    range.setStart(node, match.index);
    range.setEnd(node, end);
    return { term: match[0], sentence: sentenceAround(node.parentElement?.closest("p, li, blockquote, h1, h2, h3, h4, td, dd")?.textContent ?? text, match[0]), range };
  }
  return null;
};

/** The sentence of `block` holding `term`, or the block's start when no sentence holds it. */
export const sentenceAround = (block: string, term: string): string => {
  const sentences = block.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
  const found = sentences.find((sentence) => sentence.includes(term)) ?? sentences[0] ?? "";
  return found.slice(0, 600).trim();
};
