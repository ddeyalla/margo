// Builds passages.json: every distinct passage the reader asked the tutor about (with
// its saved context), plus one paragraph from each of ten other EPUBs, chosen from BOOKS_DIR by a hash of their path.
// Usage: node scripts/card-eval/passages.mjs "$PWD" <out>/passages.json "$BOOKS_DIR"
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repo = process.argv[2];
const out = process.argv[3];
const require = createRequire(path.join(repo, "package.json"));
const { unzipSync, strFromU8 } = require("fflate");

const CONTEXT = 1500;
const flat = (s) => s.replace(/\s+/g, " ").trim();

// 1. Real passages from saved threads.
const titles = {};
const passages = [];
for (const f of fs.readdirSync(path.join(repo, "data"))) {
  if (!f.endsWith(".json") || f === "settings.json") continue;
  const d = JSON.parse(fs.readFileSync(path.join(repo, "data", f), "utf8"));
  for (const t of d.threads ?? []) {
    if (!t.quote) continue;
    passages.push({ source: "thread", book: d.title ?? f.slice(0, 8), chapter: t.chapterTitle, before: t.before, quote: t.quote, after: t.after });
  }
}

// Book titles for thread passages come from the notes copies when present.
for (const f of fs.readdirSync(path.join(repo, "notes"))) {
  const text = fs.readFileSync(path.join(repo, "notes", f), "utf8");
  const id = text.match(/bookId: (\w+)/)?.[1];
  const title = text.match(/title: "(.*)"/)?.[1];
  if (id && title) titles[id.slice(0, 8)] = title;
}
const { createHash } = await import("node:crypto");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const file of walk(process.argv[4])) {
  const id = createHash("sha1").update(path.relative(process.argv[4], file)).digest("hex");
  titles[id.slice(0, 8)] ??= path.basename(file).replace(/\s*(--|\().*$/, "").replace(/\.(epub|pdf)$/, "");
}
for (const p of passages) p.book = (titles[p.book] ?? p.book).replace(/ \(for.*\)$/, "");
const seen = new Set();
for (let k = passages.length - 1; k >= 0; k--) {
  const key = flat(passages[k].quote).slice(0, 40);
  if (seen.has(key)) passages.splice(k, 1);
  else seen.add(key);
}

// 2. Paragraphs from other EPUBs, picked deterministically from the middle of the book.
const epubText = (file) => {
  const zip = unzipSync(fs.readFileSync(file));
  const read = (n) => strFromU8(zip[n]);
  const container = read("META-INF/container.xml");
  const opfPath = container.match(/full-path="([^"]+)"/)[1];
  const opf = read(opfPath);
  const base = path.posix.dirname(opfPath);
  const items = Object.fromEntries([...opf.matchAll(/<item\b[^>]*>/g)].map((m) => [m[0].match(/id="([^"]+)"/)?.[1], m[0].match(/href="([^"]+)"/)?.[1]]));
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)].map((m) => items[m[1]]);
  return spine.map((href) => {
    const name = decodeURIComponent(base === "." ? href : `${base}/${href}`);
    const html = zip[name] ? strFromU8(zip[name]) : "";
    return [...html.replace(/<(script|style)[\s\S]*?<\/\1>/g, "").matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)]
      .map((m) => flat(m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "’").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')))
      .filter(Boolean);
  });
};

const booksDir = process.argv[4];
const WANTED = 10;
// No names are stored here: the EPUBs are ordered by a hash of their relative path, which is
// deterministic but not alphabetical, and tried in that order until WANTED have a usable paragraph.
const candidates = walk(booksDir)
  .filter((f) => f.toLowerCase().endsWith(".epub"))
  .map((f) => ({ file: f, key: createHash("sha1").update(path.relative(booksDir, f)).digest("hex") }))
  .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
let picked = 0;
for (const { file } of candidates) {
  if (picked >= WANTED) break;
  const title = path.basename(file).replace(/\s*(--|\().*$/, "").replace(/\.epub$/i, "");
  let all;
  try { all = epubText(file); } catch { console.error("skip", title, "unreadable"); continue; }
  const chapters = all.filter((c) => c.join(" ").length > 8000);
  if (!chapters.length) { console.error("skip", title, all.length, all.map((c) => c.length).slice(0, 10)); continue; }
  const chapter = chapters[Math.floor(chapters.length / 2)];
  const i = chapter.findIndex((p, k) => k > chapter.length / 3 && p.length >= 180 && p.length <= 450);
  if (i < 0) { console.error("skip", title, "no paragraph"); continue; }
  const before = chapter.slice(0, i).join("\n\n").slice(-CONTEXT);
  const after = chapter.slice(i + 1).join("\n\n").slice(0, CONTEXT);
  picked++;
  passages.push({ source: "book", book: title, chapter: null, before, quote: chapter[i], after });
}

fs.writeFileSync(out, JSON.stringify(passages.map((p, i) => ({ id: i + 1, ...p })), null, 2));
console.log(passages.length, "passages");
for (const p of passages) console.log(`- [${p.source}] ${p.book}: ${p.quote.slice(0, 90)}`);
