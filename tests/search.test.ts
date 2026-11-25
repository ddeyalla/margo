import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pdfBlocks } from "@/lib/server/search/book-text";
import { searchFile, searchLibrary } from "@/lib/server/search";
import { scanLibrary } from "@/lib/server/library";
import { chunkRanges, makeSource, searchSources, tokenize, type SearchDoc } from "@/lib/shared/search";
import { emptyBookState, type Anchor, type BookId } from "@/lib/shared/types";
import { makeEpub, makePdf } from "./fixtures/books";

const ID = "a".repeat(40) as BookId;
const OTHER = "b".repeat(40) as BookId;
const at = (n: number): Anchor => ({ kind: "pdf", page: 1, start: n, end: n + 1 });
/* Every part gets a place of its own, unless a test shares parts between documents on purpose. */
let place = 100;
const doc = (kind: SearchDoc["kind"], ...texts: string[]): SearchDoc => ({ kind, parts: texts.map((text) => ({ text, anchor: at((place += 1)), chapter: null })) });

describe("tokenize", () => {
  it("splits on anything but letters and digits, folding case and accents", () => {
    expect(tokenize("Naïve CAFÉ, Привет — 42nd!")).toEqual(["naive", "cafe", "привет", "42nd"]);
  });

  it("stems plurals, -ing and -ed, so a word's forms are one term", () => {
    expect(tokenize("read reads reading readings")).toEqual(["read", "read", "read", "read"]);
    expect(tokenize("stop stops stopped stopping")).toEqual(["stop", "stop", "stop", "stop"]);
    expect(tokenize("story stories copied copying classes boxes")).toEqual(["storie", "storie", "copie", "copie", "class", "box"]);
  });

  it("keeps -ie words apart from -y words, and stems do and go", () => {
    expect(tokenize("movie movies")).toEqual(["movie", "movie"]);
    expect(tokenize("play plays played")).toEqual(["play", "play", "play"]);
    expect(tokenize("do does doing go goes going")).toEqual(["do", "do", "do", "go", "go", "go"]);
    expect(tokenize("constructor valueof hasownproperty")).toEqual(["constructor", "valueof", "hasownpropertie"]);
  });

  it("leaves short words, -ss/-us/-is, stems without a vowel and other scripts alone", () => {
    const kept = ["is", "was", "this", "glass", "status", "analysis", "thing", "string", "spring", "speed", "add"];
    expect(tokenize(kept.join(" "))).toEqual(kept);
    expect(tokenize("added")).toEqual(["add"]);
    expect(tokenize("reader water letter Привет")).toEqual(["reader", "water", "letter", "привет"]);
  });
});

describe("chunkRanges", () => {
  const words = (n: number) => Array.from({ length: n }, () => "w").join(" ");

  it("fills chunks to the size, repeating the end of each in the next", () => {
    const blocks = Array.from({ length: 10 }, () => ({ text: words(10), part: 0 }));
    /* At 20% of 30 terms no whole block fits in the overlap; at 34% one does. */
    expect(chunkRanges(blocks, 30, 0.2)).toEqual([[0, 2], [3, 5], [6, 8], [9, 9]]);
    expect(chunkRanges(blocks, 30, 0.34)).toEqual([[0, 2], [2, 4], [4, 6], [6, 8], [8, 9]]);
  });

  it("never crosses a part, and keeps a long block whole", () => {
    const blocks = [
      { text: words(5), part: 1 },
      { text: words(5), part: 1 },
      { text: words(50), part: 2 },
      { text: words(5), part: 2 },
    ];
    expect(chunkRanges(blocks, 30, 0.2)).toEqual([[0, 1], [2, 2], [3, 3]]);
  });
});

describe("searchSources", () => {
  it("ranks a rare word above a common one, across books", () => {
    const sources = [
      makeSource(ID, [doc("text", "the cat sat"), doc("text", "the dog ran"), doc("text", "the end")]),
      makeSource(OTHER, [doc("note", "the quokka smiled")]),
    ];
    const hits = searchSources(sources, "the quokka ");
    expect(hits[0]).toMatchObject({ bookId: OTHER, kind: "note", snippet: "the quokka smiled", marks: [[0, 3], [4, 10]] });
    expect(hits).toHaveLength(4);
  });

  it("matches the last word as a prefix while it is being typed, and not after a space", () => {
    const sources = [makeSource(ID, [doc("text", "photosynthesis in leaves")])];
    expect(searchSources(sources, "photosyn")).toHaveLength(1);
    expect(searchSources(sources, "photosyn ")).toHaveLength(0);
    expect(searchSources(sources, "ph")).toHaveLength(0);
  });

  it("finds a word's other forms, and marks the book's own words", () => {
    const [hit] = searchSources([makeSource(ID, [doc("text", "She stopped reading at dawn.")])], "stops reads ");
    expect(hit.marks.map(([start, end]) => hit.snippet.slice(start, end))).toEqual(["stopped", "reading"]);
  });

  it("keeps finding a stemmed word at every step of typing it", () => {
    const sources = [makeSource(ID, [doc("text", "the reading room")])];
    for (const typed of ["rea", "read", "readi", "readin", "reading"]) {
      const [hit] = searchSources(sources, typed);
      expect(hit?.marks.map(([start, end]) => hit.snippet.slice(start, end)), typed).toEqual(["reading"]);
    }
  });

  it("matches a finished last word with no space after by its stem, and not a shorter word it starts with", () => {
    const sources = [makeSource(ID, [doc("text", "two story books"), doc("text", "stop the car"), doc("text", "she studied")])];
    const marked = (query: string) => searchSources(sources, query).flatMap((hit) => hit.marks.map(([start, end]) => hit.snippet.slice(start, end)));
    expect(marked("stories")).toEqual(["story"]);
    expect(marked("stori")).toEqual(["story"]);
    expect(marked("stopping")).toEqual(["stop"]);
    expect(marked("stoppin")).toEqual(["stop"]);
    expect(marked("books")).toEqual(["books"]);
    expect(marked("studies")).toEqual(["studied"]);
    expect(marked("their")).toEqual([]);
    expect(marked("cart")).toEqual([]);
  });

  it("keeps a stemmed word's results at every keystroke, through a doubled consonant", () => {
    const sources = [makeSource(ID, [doc("text", "they stopped short")])];
    for (const typed of ["sto", "stop", "stopp", "stoppe", "stopped", "stoppi", "stoppin", "stopping"]) {
      expect(searchSources(sources, typed), typed).toHaveLength(1);
    }
  });

  it("does not stretch a word that is a term into a shorter one while it is typed", () => {
    const sources = [makeSource(ID, [doc("text", "they cared for the car"), doc("text", "she was making it"), doc("text", "begin with care, make it")])];
    const marked = (query: string) => searchSources(sources, query).flatMap((hit) => hit.marks.map(([start, end]) => hit.snippet.slice(start, end)));
    expect(marked("care").sort()).toEqual(["care"]);
    expect(marked("make")).toEqual(["make"]);
    expect(marked("begin")).toEqual(["begin"]);
    expect(marked("makin")).toEqual(["making"]);
  });

  it("matches -ie plurals both ways", () => {
    const sources = [makeSource(ID, [doc("text", "two movies tonight")])];
    expect(searchSources(sources, "movie night ")).toHaveLength(1);
    expect(searchSources(sources, "movie")).toHaveLength(1);
  });

  it("lands a phrase-boosted result on the part that holds the phrase", () => {
    const chunk = doc("text", "suffering, suffering: only life is suffering only", "they say life is only suffering");
    const [hit] = searchSources([makeSource(ID, [chunk, doc("text", "other words")])], "life is only suffering");
    expect(hit.anchor).toEqual(chunk.parts[1].anchor);
  });

  it("ranks a document holding the query as a phrase above one with the same words apart", () => {
    const apart = doc("text", "suffering is life only");
    const phrase = doc("text", "life is only suffering");
    const sources = [makeSource(ID, [apart, phrase, doc("text", "other words"), doc("text", "more words")])];
    const hits = searchSources(sources, "life is only suffering");
    expect(hits.map((hit) => hit.anchor)).toEqual([phrase.parts[0].anchor, apart.parts[0].anchor]);
    expect(hits[0].score).toBeCloseTo(hits[1].score * 2);
  });

  it("weighs a phrase by its words' rarity, so common words side by side lift little", () => {
    const common = doc("text", "it is only here a word rare");
    const rare = doc("text", "only here it a is rare word");
    const filler = Array.from({ length: 20 }, () => doc("text", "it is only a word here"));
    const hits = searchSources([makeSource(ID, [common, rare, ...filler])], "it is only rare word");
    const [scoreCommon, scoreRare] = [common, rare].map((d) => hits.find((hit) => hit.anchor === d.parts[0].anchor)!.score);
    /* "rare word" is the rarer run; "it is only" covers more words but less of the weight. */
    expect(scoreRare).toBeGreaterThan(scoreCommon);
  });

  it("points a result at its part with the most of the query, and keeps one result per place", () => {
    const shared = doc("text", "an opening line", "the river of time flows", "a closing line");
    const sources = [makeSource(ID, [shared, { kind: "text", parts: shared.parts.slice(1) }])];
    const hits = searchSources(sources, "river time");
    expect(hits).toHaveLength(1);
    expect(hits[0].anchor).toEqual(shared.parts[1].anchor);
  });

  it("cuts a long part around the first match", () => {
    const long = `${"filler ".repeat(60)}needle ${"more ".repeat(60)}`;
    const [hit] = searchSources([makeSource(ID, [doc("text", long)])], "needle");
    expect(hit.snippet.startsWith("…")).toBe(true);
    expect(hit.snippet.endsWith("…")).toBe(true);
    expect(hit.snippet.length).toBeLessThan(240);
    const [[start, end]] = hit.marks;
    expect(hit.snippet.slice(start, end)).toBe("needle");
  });
});

describe("PDF blocks", () => {
  it("gives each line the character range the reader's text layer counts", async () => {
    const blocks = await pdfBlocks(makePdf([["First line here", "Second line"], ["Page two text"]]));
    expect(blocks.map((block) => [block.text, block.anchor, block.part])).toEqual([
      ["First line here", { kind: "pdf", page: 1, start: 0, end: 15 }, 1],
      ["Second line", { kind: "pdf", page: 1, start: 16, end: 27 }, 1],
      ["Page two text", { kind: "pdf", page: 2, start: 0, end: 13 }, 2],
    ]);
  });
});

const setUp = async () => {
  const base = await mkdtemp(path.join(tmpdir(), "rigg-learn-search-"));
  const root = path.join(base, "books");
  const dataDir = path.join(base, "data");
  await mkdir(root, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    path.join(root, "Rivers.epub"),
    makeEpub([
      { title: "Sources", paragraphs: ["Every river begins as rain on high ground.", "Springs feed the first streams."] },
      { title: "Deltas", paragraphs: ["Silt builds a delta where the river meets the sea."] },
    ]),
  );
  await writeFile(path.join(root, "Tides.pdf"), makePdf([["The moon pulls the tides."], ["Neap tides are small."]]));
  const books = await scanLibrary(root, dataDir);
  const rivers = books.find((book) => book.format === "epub")!;
  const tides = books.find((book) => book.format === "pdf")!;
  return { root, dataDir, rivers, tides };
};

describe("searchLibrary", () => {
  it("searches what was saved at once, builds the text index in the background, then finds the text", async () => {
    const { root, dataDir, rivers, tides } = await setUp();
    const note = {
      id: "n1",
      anchor: { kind: "epub" as const, cfi: "epubcfi(/6/2!/4/4/1:0)" },
      quote: "Every river begins",
      chapterTitle: "Sources",
      highlightId: null,
      body: "Remember the meander rule.",
      tags: [],
      createdAt: "",
      updatedAt: "",
    };
    const state = { ...emptyBookState(), meta: { title: "On Rivers", author: null, format: "epub" as const, relPath: "Rivers.epub" }, notes: [note] };
    await writeFile(path.join(dataDir, `${rivers.id}.json`), JSON.stringify(state));

    const first = await searchLibrary("meander", { root, dataDir });
    expect(first.indexing).toEqual({ ready: 0, total: 2, failed: 0 });
    expect(first.books).toEqual([
      {
        id: rivers.id,
        title: "On Rivers",
        format: "epub",
        chapters: [{ title: "Sources", hits: [{ kind: "note", anchor: note.anchor, snippet: "Remember the meander rule.", marks: [[13, 20]] }] }],
      },
    ]);
    await first.building;

    const delta = await searchLibrary("silt delta", { root, dataDir });
    expect(delta.indexing).toEqual({ ready: 2, total: 2, failed: 0 });
    expect(delta.books[0]).toMatchObject({ id: rivers.id, chapters: [{ title: "Deltas" }] });
    const [hit] = delta.books[0].chapters[0].hits;
    expect(hit).toMatchObject({ kind: "text", snippet: "Silt builds a delta where the river meets the sea." });
    expect(hit.anchor).toEqual({ kind: "epub", cfi: "epubcfi(/6/4!/4/4/1:0)" });

    const neap = await searchLibrary("neap", { root, dataDir });
    expect(neap.books[0]).toMatchObject({ id: tides.id, title: "Tides", format: "pdf" });
    expect(neap.books[0].chapters[0].hits[0].anchor).toEqual({ kind: "pdf", page: 2, start: 0, end: 21 });
  });

  it("keeps the index in the data folder, rebuilds it when the book changes or it is deleted, and drops it for a forgotten book", async () => {
    const { root, dataDir, rivers } = await setUp();
    await (await searchLibrary("", { root, dataDir })).building;
    const file = searchFile(dataDir, rivers.id);
    const built = JSON.parse(await readFile(file, "utf8"));
    expect(built.fingerprint.size).toBe((await stat(path.join(root, "Rivers.epub"))).size);

    await writeFile(path.join(root, "Rivers.epub"), makeEpub([{ title: "Floods", paragraphs: ["A floodplain stores water."] }]));
    const later = new Date(Date.now() + 5_000);
    await utimes(path.join(root, "Rivers.epub"), later, later);
    await scanLibrary(root, dataDir);
    const changed = await searchLibrary("floodplain", { root, dataDir });
    expect(changed.indexing.ready).toBe(1);
    await changed.building;
    expect((await searchLibrary("floodplain", { root, dataDir })).books).toHaveLength(1);

    /* A book the library no longer knows: its index goes on the next run. */
    const stray = searchFile(dataDir, "c".repeat(40) as BookId);
    await writeFile(stray, "{}");
    await rm(file);
    await scanLibrary(root, dataDir);
    await (await searchLibrary("", { root, dataDir })).building;
    expect(JSON.parse(await readFile(file, "utf8")).chunks.length).toBeGreaterThan(0);
    await expect(stat(stray)).rejects.toThrow();
  });
});
