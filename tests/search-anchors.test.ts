// @vitest-environment jsdom
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { addFixations, skipFixations } from "@/components/reader/fixations";
import { epubBlocks } from "@/lib/server/search/book-text";
import { fromRange, joinIndir, parse, toRange } from "@/public/vendor/foliate-js/epubcfi.js";

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

/* The spine is the fourth element of the package, not the usual third, so its step is /8, not /6. */
const OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test</dc:title><dc:identifier id="id">x</dc:identifier></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="one" href="text/one.xhtml" media-type="application/xhtml+xml"/>
    <item id="two" href="text/two%20b.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <bindings/>
  <spine><itemref idref="one" id="ref-one"/><itemref idref="two"/></spine>
</package>`;

const NAV = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Nav</title></head>
<body><nav epub:type="toc"><ol>
  <li><a href="text/one.xhtml">Chapter One</a></li>
  <li><a href="text/two%20b.xhtml#later">Chapter Two</a></li>
</ol></nav></body></html>`;

/* A self-closing <a/> would shift every later element if the section were parsed as HTML. */
const ONE = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head>
<body>
  <a id="top"/>
  <h1>Chapter one</h1>
  <p>Zero to <em>One</em> is about building the future.</p>
  <div><p id="p2">A well-known <a href="#n1">rule</a> about photosynthesis.</p>
  <blockquote>Quoted <b>words</b> here</blockquote></div>
  <p>Naïve café,<br/>second line</p>
</body></html>`;

const TWO = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Two</title></head>
<body><p>Still the first chapter.</p><h2 id="later">Chapter two</h2><p>The second chapter starts.</p></body></html>`;

const EPUB = zipSync({
  mimetype: strToU8("application/epub+zip"),
  "META-INF/container.xml": strToU8(CONTAINER),
  "OEBPS/content.opf": strToU8(OPF),
  "OEBPS/nav.xhtml": strToU8(NAV),
  "OEBPS/text/one.xhtml": strToU8(ONE),
  "OEBPS/text/two b.xhtml": strToU8(TWO),
});

const SECTIONS = [ONE, TWO];

/** Resolves a CFI the way the reader does (foliate's resolveCFI), in a browser DOM of the section it names. */
const resolve = (cfi: string, marked: boolean) => {
  const parts = parse(cfi);
  const top = (parts.parent ?? parts).shift();
  /* Every child of this spine is an itemref, so the step's index names the section. */
  const index = top.at(-1).index / 2 - 1;
  const doc = new DOMParser().parseFromString(SECTIONS[index], "application/xhtml+xml");
  if (marked) addFixations(doc);
  return { index, range: toRange(doc, parts, marked ? skipFixations : undefined) as Range };
};

const textFrom = (range: Range) => {
  const block = (range.startContainer.nodeType === 3 ? range.startContainer.parentElement : (range.startContainer as Element))!;
  return block.closest("p, h1, h2, blockquote")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
};

describe("EPUB search anchors", () => {
  const blocks = epubBlocks(EPUB);

  it("reads every block in reading order, with its chapter", () => {
    expect(blocks.map((block) => [block.text, block.chapter, block.part])).toEqual([
      ["Chapter one", "Chapter One", 0],
      ["Zero to One is about building the future.", "Chapter One", 0],
      ["A well-known rule about photosynthesis.", "Chapter One", 0],
      ["Quoted words here", "Chapter One", 0],
      ["Naïve café, second line", "Chapter One", 0],
      ["Still the first chapter.", "Chapter One", 1],
      ["Chapter two", "Chapter Two", 1],
      ["The second chapter starts.", "Chapter Two", 1],
    ]);
  });

  it("names the spine item by its real step in the package", () => {
    for (const block of blocks) expect(block.anchor.kind === "epub" && block.anchor.cfi).toMatch(/^epubcfi\(\/8\/[24](\[ref-one\])?!/);
  });

  it("gives CFIs that foliate resolves to the start of the same block, with and without bold starts", () => {
    for (const marked of [false, true]) {
      for (const block of blocks) {
        if (block.anchor.kind !== "epub") throw new Error("not epub");
        const { index, range } = resolve(block.anchor.cfi, marked);
        expect(index).toBe(block.part);
        /* A <br/> reads as a space in the index and as nothing in textContent. */
        expect(textFrom(range).replace(/\s/g, "")).toBe(block.text.replace(/\s/g, ""));
        expect(range.collapsed).toBe(true);
      }
    }
  });

  it("makes the same CFI the reader makes for a caret at the start of that text", () => {
    const doc = new DOMParser().parseFromString(ONE, "application/xhtml+xml");
    const first = doc.getElementById("p2")!.firstChild!;
    const reader = joinIndir("epubcfi(/8/2[ref-one])", fromRange({ startContainer: first, startOffset: 0, collapsed: true }));
    expect(blocks[2].anchor).toEqual({ kind: "epub", cfi: reader });
  });
});
