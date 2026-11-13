// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { addFixations, FIXATION_TAG, removeFixations, skipFixations } from "@/components/reader/fixations";
import { fromRange, parse, toRange } from "@/public/vendor/foliate-js/epubcfi.js";

/* A section the way an EPUB ships it: XHTML, with inline markup, ids, code and a hyphenated word. */
const SECTION = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title><style>p { margin: 0 }</style></head>
<body>
  <h1 id="start">Chapter one</h1>
  <p>Zero to <em>One</em> is about building the future, not copying it.</p>
  <p id="p2">A well-known <a href="#n1">rule</a>: run <code>npm test</code> before “shipping”.</p>
  <pre>const x = 42;</pre>
  <p>Naïve café — Привет, <b>bold</b>ly <span><i>nested</i> words</span> end</p>
</body></html>`;

const parseSection = () => new DOMParser().parseFromString(SECTION, "application/xhtml+xml");

const marked = () => {
  const doc = parseSection();
  addFixations(doc);
  return doc;
};

const textNodes = (doc: Document) => {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
};

/**
 * The DOM point `at` characters into the body's text. At the edge of two text
 * nodes, "end" picks the end of the first and "start" the start of the next.
 */
const pointAt = (doc: Document, at: number, side: "end" | "start"): [Text, number] => {
  let before = 0;
  const nodes = textNodes(doc);
  for (const node of nodes) {
    const length = node.data.length;
    if (side === "end" ? at <= before + length : at < before + length) return [node, at - before];
    before += length;
  }
  const last = nodes[nodes.length - 1];
  return [last, last.data.length];
};

const rangeOf = (doc: Document, start: number, end: number, side: "end" | "start") => {
  const range = doc.createRange();
  range.setStart(...pointAt(doc, start, side));
  range.setEnd(...pointAt(doc, end, side));
  return range;
};

describe("marking bold starts in a section", () => {
  it("wraps the start of each word in body text and leaves the text itself unchanged", () => {
    const plain = parseSection();
    const doc = marked();
    expect(doc.body.textContent).toBe(plain.body.textContent);
    const marks = Array.from(doc.getElementsByTagName(FIXATION_TAG), (mark) => mark.textContent);
    expect(marks.slice(0, 6)).toEqual(["Cha", "o", "Ze", "t", "O", "i"]);
    expect(doc.getElementsByTagName(FIXATION_TAG)[0].namespaceURI).toBe("http://www.w3.org/1999/xhtml");
  });

  it("skips code, preformatted text, scripts, styles, maths and SVG", () => {
    const doc = new DOMParser().parseFromString(
      `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Use <code>git status</code> <kbd>Cmd</kbd> <samp>output here</samp></p>
<pre>for item in list</pre><script>var words = 1</script><style>p { color: red }</style>
<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>radius</mi></math>
<svg xmlns="http://www.w3.org/2000/svg"><text>label text</text></svg></body></html>`,
      "application/xhtml+xml",
    );
    addFixations(doc);
    expect(Array.from(doc.getElementsByTagName(FIXATION_TAG), (mark) => mark.textContent)).toEqual(["U"]);
  });

  it("marks a section only once", () => {
    const doc = marked();
    const once = doc.body.innerHTML;
    addFixations(doc);
    expect(doc.body.innerHTML).toBe(once);
  });

  it("restores the section exactly when the marks come out", () => {
    const doc = marked();
    removeFixations(doc);
    expect(doc.body.innerHTML).toBe(parseSection().body.innerHTML);
    expect(textNodes(doc).length).toBe(textNodes(parseSection()).length);
  });
});

describe("CFIs with bold starts", () => {
  const plain = parseSection();
  const doc = marked();
  const length = plain.body.textContent!.length;

  it("gives every range the same CFI as in the unmarked section", () => {
    let checked = 0;
    for (let start = 0; start <= length; start += 1) {
      for (let end = start; end <= length; end += 3) {
        for (const side of ["end", "start"] as const) {
          expect(fromRange(rangeOf(doc, start, end, side), skipFixations)).toBe(fromRange(rangeOf(plain, start, end, side)));
        }
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(4000);
  });

  it("resolves a CFI to the same text in the marked and the unmarked section", () => {
    for (let start = 0; start < length; start += 2) {
      for (let end = start + 1; end <= length; end += 5) {
        const original = rangeOf(plain, start, end, "end");
        const cfi = fromRange(original);
        expect(toRange(doc, parse(cfi), skipFixations).toString()).toBe(original.toString());
        expect(toRange(plain, parse(cfi), skipFixations).toString()).toBe(original.toString());
      }
    }
  });

  it("reads a boundary on a mark itself as the edge of its text", () => {
    const mark = doc.getElementsByTagName(FIXATION_TAG)[2];
    expect(mark.textContent).toBe("Ze");
    const range = doc.createRange();
    range.setStart(mark, 0);
    range.setEnd(mark, 1);
    const at = plain.body.textContent!.indexOf("Zero");
    expect(fromRange(range, skipFixations)).toBe(fromRange(rangeOf(plain, at, at + 2, "start")));
  });

  it("keeps a highlight's text when it is made with the marks on and shown with them off, and back", () => {
    const phrase = "building the future";
    const at = plain.body.textContent!.indexOf(phrase);
    const madeOn = fromRange(rangeOf(doc, at, at + phrase.length, "start"), skipFixations);
    const madeOff = fromRange(rangeOf(plain, at, at + phrase.length, "end"), skipFixations);
    expect(madeOn).toBe(madeOff);
    expect(toRange(plain, parse(madeOn), skipFixations).toString()).toBe(phrase);
    expect(toRange(doc, parse(madeOff), skipFixations).toString()).toBe(phrase);
    const unmarked = marked();
    removeFixations(unmarked);
    expect(toRange(unmarked, parse(madeOn), skipFixations).toString()).toBe(phrase);
  });
});
