/**
 * Bold starts: the first letters of each word in bold, so the eye can jump
 * from one bold start to the next. In the style of Bionic Reading.
 */

/** The share of a word longer than four letters that is bold. */
const FIXATION_RATIO = 0.4;

/** The element that wraps each bold start. CFIs skip it, so positions match the unmarked text. */
export const FIXATION_TAG = "rl-fx";

const XHTML = "http://www.w3.org/1999/xhtml";

/* Text in these is left alone. */
const SKIPPED = new Set(["code", "pre", "kbd", "samp", "script", "style", "math", "svg", FIXATION_TAG]);

/* A letter or digit with its combining marks, from a script that puts spaces between words.
   Chinese, Japanese, Korean and the other unspaced scripts have no word starts to mark. */
const LETTER = String.raw`(?![\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}\p{sc=Bopomofo}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}])[\p{L}\p{N}]\p{M}*`;

/* A run of letters and digits. An apostrophe between letters stays in the word, so "don't" is one word, not "don" and a bold "t". */
const WORD = new RegExp(String.raw`(?:${LETTER})+(?:['’](?:${LETTER})+)*`, "gu");

/* One character as the reader sees it: a code point and the marks that combine with it. */
const CHARACTER = /\P{M}\p{M}*/gu;

/** How many characters of a word of `length` characters are bold. */
const fixationLength = (length: number) => (length <= 3 ? 1 : length === 4 ? 2 : Math.ceil(length * FIXATION_RATIO));

/** The [start, end) offsets of the bold start of every word in `text`, in order. */
export const fixations = (text: string): [start: number, end: number][] =>
  Array.from(text.matchAll(WORD), ({ 0: word, index }) => {
    const characters = word.match(CHARACTER) ?? [];
    const bold = characters.slice(0, fixationLength(characters.length)).join("");
    return [index, index + bold.length];
  });

/** A CFI node filter that sees through bold starts, so a CFI is the same with them as without. */
export const skipFixations = (node: Node): number =>
  node.nodeType === 1 && (node as Element).localName === FIXATION_TAG ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT;

/** Marks the bold start of every word in the document's body. A document already marked is left as it is. */
export const addFixations = (doc: Document) => {
  const { body } = doc;
  if (!body || body.getElementsByTagName(FIXATION_TAG).length) return;
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.nodeType !== 1 ? NodeFilter.FILTER_ACCEPT : SKIPPED.has((node as Element).localName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP,
  });
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
  for (const text of texts) {
    const spans = fixations(text.data);
    if (!spans.length) continue;
    const parts = doc.createDocumentFragment();
    let at = 0;
    for (const [start, end] of spans) {
      if (start > at) parts.append(text.data.slice(at, start));
      const mark = doc.createElementNS(XHTML, FIXATION_TAG);
      mark.textContent = text.data.slice(start, end);
      parts.append(mark);
      at = end;
    }
    if (at < text.data.length) parts.append(text.data.slice(at));
    text.replaceWith(parts);
  }
};

/** Takes the bold starts out again, joining each word's text back into one text node. */
export const removeFixations = (doc: Document) => {
  const parents = new Set<Node>();
  for (const mark of Array.from(doc.getElementsByTagName(FIXATION_TAG))) {
    if (mark.parentNode) parents.add(mark.parentNode);
    mark.replaceWith(mark.textContent ?? "");
  }
  for (const parent of parents) parent.normalize();
};
