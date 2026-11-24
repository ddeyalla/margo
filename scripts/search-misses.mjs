// Counts the queries keyword search misses: the measurement that decides whether search needs vectors.
//
//   node scripts/search-misses.mjs <queries.json> --data <DATA_DIR> [--base http://127.0.0.1:3000] [--k 5]
//
// queries.json is a list of { "query": "what you would type", "passage": "words copied from the passage you
// wanted", "book": "part of its title or file name (optional)" }. The server at --base must be running on the
// same DATA_DIR, with every book indexed. A query finds its passage when a result among the first k, in the
// order the search box shows them, lands in a chunk that holds the passage, or quotes it (a highlight or note).
// Reads only: it never writes to the data folder.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const file = args.find((arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--"));
const dataDir = option("data");
const base = option("base", "http://127.0.0.1:3000");
const k = Number(option("k", "5"));
if (!file || !dataDir) {
  console.error("Usage: node scripts/search-misses.mjs <queries.json> --data <DATA_DIR> [--base URL] [--k 5]");
  process.exit(1);
}

/* Names compare loosely; passages compare as the search's own terms (case and accents folded, punctuation dropped)
   run together, so curly quotes, dashes and a word hyphenated across a line break still match. */
const flat = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();
const terms = (text) =>
  [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => m[0].normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()).join("");
const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

/* Each indexed book with the names a query's "book" can match. */
const library = readJson(path.join(dataDir, "library.json"))?.books ?? {};
const searchDir = path.join(dataDir, "search");
const books = readdirSync(searchDir)
  .filter((name) => /^[0-9a-f]{40}\.json$/.test(name))
  .map((name) => {
    const id = name.slice(0, 40);
    const title = readJson(path.join(dataDir, `${id}.json`))?.meta?.title ?? "";
    return { id, names: flat(`${title} ${library[id]?.relPath ?? ""}`), index: readJson(path.join(searchDir, name)) };
  });

/** The anchors of every block in a chunk that holds the passage, as JSON, so a result anywhere in that chunk counts. */
const targets = (passage, book) => {
  const wanted = terms(passage);
  if (!wanted) return new Set();
  const anchors = new Set();
  for (const { names, index } of books) {
    if (!index || (book && !names.includes(flat(book)))) continue;
    const hits = new Set(index.blocks.flatMap((block, i) => (terms(block.t).includes(wanted) ? [i] : [])));
    /* A passage can run across two blocks: look in each chunk's joined text too. */
    for (const [from, to] of index.chunks) {
      const blocks = index.blocks.slice(from, to + 1);
      if (blocks.some((_, i) => hits.has(from + i)) || terms(blocks.map((b) => b.t).join(" ")).includes(wanted)) {
        for (const block of blocks) anchors.add(JSON.stringify(block.a));
      }
    }
  }
  return anchors;
};

const queries = readJson(file);
if (!Array.isArray(queries)) {
  console.error(`${file} is not a JSON list of queries.`);
  process.exit(1);
}

/* Counting before every book is indexed would score a book's missing text as misses. */
const status = await (await fetch(`${base}/api/search?q=`)).json();
const { ready, failed, total } = status.indexing ?? {};
if (ready + failed !== total) {
  console.error(`Only ${ready} of ${total} books are indexed yet. Open the search box or wait, then run this again.`);
  process.exit(1);
}
if (failed) console.log(`${failed} of ${total} books' text couldn't be read; passages in them can't be found.\n`);

let misses = 0;
let unknown = 0;
for (const { query, passage, book } of queries) {
  const anchors = targets(passage, book);
  if (!anchors.size) {
    unknown += 1;
    console.log(`??    ${JSON.stringify(query)}: passage not found in any index`);
    continue;
  }
  const response = await fetch(`${base}/api/search?q=${encodeURIComponent(query)}`);
  const results = await response.json();
  const shown = results.books.flatMap((b) => b.chapters.flatMap((c) => c.hits));
  const quote = terms(passage).slice(0, 40);
  const rank = shown.findIndex((hit) => anchors.has(JSON.stringify(hit.anchor)) || terms(hit.snippet).includes(quote)) + 1;
  const found = rank > 0 && rank <= k;
  if (!found) misses += 1;
  console.log(`${found ? "hit " : "MISS"}  ${rank ? `#${rank}`.padEnd(4) : "--  "}  ${JSON.stringify(query)}`);
}
console.log(`\n${misses} of ${queries.length - unknown} queries missed (not in the first ${k} results). ${unknown} of ${queries.length} had no passage to look for (??).`);
