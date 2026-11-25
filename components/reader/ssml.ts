/**
 * foliate's TTS hands out each block of a section as SSML with a <mark> before every word. The browser's
 * speech voices don't speak SSML, so a block becomes the plain text they will speak, and the marks become
 * offsets into that text. A voice's word boundary carries a character offset; the mark just before it names
 * the word, and foliate's `setMark` turns that name back into the word's Range on the page.
 */

export interface SpokenBlock {
  /** What the voice is given, character for character. */
  text: string;
  /** Each mark's name and the offset in `text` where its word starts, in order. */
  marks: { offset: number; name: string }[];
}

/** Parses foliate's SSML. Text is kept exactly, since a boundary's offset counts every character. */
export const ssmlToText = (ssml: string): SpokenBlock => {
  const doc = new DOMParser().parseFromString(ssml, "application/xml");
  let text = "";
  const marks: SpokenBlock["marks"] = [];
  const walk = (node: Node) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3 || child.nodeType === 4) text += child.nodeValue ?? "";
      else if (child.nodeType === 1) {
        const name = (child as Element).localName;
        if (name === "mark") marks.push({ offset: text.length, name: (child as Element).getAttribute("name") ?? "" });
        /* A line break inside a block, so "end<br>Next" is not spoken as one word. */
        else if (name === "break") text += " ";
        else walk(child);
      }
    }
  };
  if (!doc.getElementsByTagName("parsererror").length) walk(doc.documentElement);
  return { text, marks };
};

/** The mark of the word a boundary at `charIndex` falls in: the last one at or before it. */
export const markAt = (marks: SpokenBlock["marks"], charIndex: number): string | null => {
  let low = 0;
  let high = marks.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (marks[mid].offset <= charIndex) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found < 0 ? null : marks[found].name;
};
