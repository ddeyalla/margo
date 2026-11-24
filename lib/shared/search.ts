import type { Anchor, BookFormat, BookId } from "./types";

/** What a search result is: a passage of the book's text, or something the reader saved. */
export type SearchKind = "text" | "highlight" | "note" | "card";

/** One result: where it is, and a short piece of its text with the matching words marked. */
export interface SearchHit {
  kind: SearchKind;
  anchor: Anchor;
  snippet: string;
  /** Character ranges of the snippet that match the query, in order. */
  marks: [start: number, end: number][];
}

export interface SearchChapter {
  title: string | null;
  hits: SearchHit[];
}

export interface SearchBook {
  id: BookId;
  title: string;
  format: BookFormat;
  chapters: SearchChapter[];
}

/** The /api/search answer: results grouped by book then chapter, best first, and how much of the library is searchable yet. */
export interface SearchResults {
  books: SearchBook[];
  indexing: {
    /** Books whose text is in the index. */
    ready: number;
    total: number;
    /** Books whose text could not be read, which only their highlights, notes and cards represent. */
    failed: number;
  };
}

interface TokenSpan {
  term: string;
  start: number;
  end: number;
}

/** Folds case and accents, so "Café" and "cafe" are one term. */
const fold = (word: string) => word.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

const tokenSpans = (text: string): TokenSpan[] =>
  [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({ term: fold(match[0]), start: match.index, end: match.index + match[0].length }));

/** The search terms in a text: runs of letters and digits, case and accents folded. No stemming and no stop words. */
export const tokenize = (text: string): string[] => tokenSpans(text).map((span) => span.term);

/** A chunk is about this many terms. */
export const CHUNK_TERMS = 300;
/** Each chunk starts with about this share of the one before it, so a passage cut at a chunk's edge is whole in the next. */
export const CHUNK_OVERLAP = 0.2;

/**
 * Groups consecutive blocks into chunks of about `size` terms that never cross a part (an EPUB section or a PDF
 * page), each starting on a block boundary and repeating about `overlap` of the previous chunk's end. Returns
 * inclusive block ranges. A block longer than `size` is a chunk of its own.
 */
export const chunkRanges = (
  blocks: readonly { text: string; part: number }[],
  size = CHUNK_TERMS,
  overlap = CHUNK_OVERLAP,
): [from: number, to: number][] => {
  const lengths = blocks.map((block) => tokenize(block.text).length);
  const ranges: [number, number][] = [];
  let from = 0;
  while (from < blocks.length) {
    let to = from;
    let count = lengths[from];
    while (to + 1 < blocks.length && blocks[to + 1].part === blocks[from].part && count < size) {
      to += 1;
      count += lengths[to];
    }
    ranges.push([from, to]);
    if (to + 1 >= blocks.length) break;
    if (blocks[to + 1].part !== blocks[from].part) {
      from = to + 1;
      continue;
    }
    /* Step back from the end while the repeated part stays within the overlap, but always move forward. */
    let next = to + 1;
    let repeated = 0;
    while (next - 1 > from && repeated + lengths[next - 1] <= size * overlap) {
      next -= 1;
      repeated += lengths[next];
    }
    from = next;
  }
  return ranges;
};

/** One piece of a searchable document, with the place a result in it jumps to. */
export interface DocPart {
  text: string;
  anchor: Anchor;
  chapter: string | null;
}

/** A document scored as a whole: a chunk of a book's blocks, or one highlight, note or card set. */
export interface SearchDoc {
  kind: SearchKind;
  parts: readonly DocPart[];
}

/** One book's documents with an inverted index: each term's documents and how often it occurs in each. */
export interface SearchSource {
  bookId: BookId;
  docs: readonly SearchDoc[];
  lengths: readonly number[];
  postings: ReadonlyMap<string, readonly [doc: number, count: number][]>;
}

export const makeSource = (bookId: BookId, docs: readonly SearchDoc[]): SearchSource => {
  const postings = new Map<string, [number, number][]>();
  const lengths = docs.map((doc, index) => {
    const counts = new Map<string, number>();
    let length = 0;
    for (const part of doc.parts) {
      for (const term of tokenize(part.text)) {
        counts.set(term, (counts.get(term) ?? 0) + 1);
        length += 1;
      }
    }
    for (const [term, count] of counts) {
      const list = postings.get(term);
      if (list) list.push([index, count]);
      else postings.set(term, [[index, count]]);
    }
    return length;
  });
  return { bookId, docs, lengths, postings };
};

const K1 = 1.2;
const B = 0.75;
/** A last word this long or longer, still being typed, also matches longer words that start with it. */
const PREFIX_MIN = 3;
const SNIPPET_CHARS = 220;
const SNIPPET_LEAD = 60;

/** A query term, or for a last word still being typed, every term that starts with it. */
interface TermGroup {
  matches(term: string): boolean;
  terms(source: SearchSource): string[];
}

const groupsOf = (query: string): TermGroup[] => {
  const all = tokenize(query);
  const words = [...new Set(all)];
  /* Only the word under the cursor is unfinished: the query ends in it, with no space after. */
  const typing = /[\p{L}\p{N}]$/u.test(query) ? all.at(-1) : undefined;
  return words.map((word) => {
    if (word === typing && word.length >= PREFIX_MIN) {
      return {
        matches: (term) => term.startsWith(word),
        terms: (source) => [...source.postings.keys()].filter((term) => term.startsWith(word)),
      };
    }
    return { matches: (term) => term === word, terms: (source) => (source.postings.has(word) ? [word] : []) };
  });
};

export interface ScoredHit extends SearchHit {
  bookId: BookId;
  chapter: string | null;
  score: number;
}

const snippetOf = (text: string, spans: TokenSpan[], matched: (term: string) => boolean): Pick<SearchHit, "snippet" | "marks"> => {
  const hits = spans.filter((span) => matched(span.term));
  let start = 0;
  let end = text.length;
  if (text.length > SNIPPET_CHARS) {
    const first = hits[0]?.start ?? 0;
    start = Math.max(0, first - SNIPPET_LEAD);
    if (start > 0) start = text.slice(start, first).search(/\s/) >= 0 ? start + text.slice(start, first).search(/\s/) + 1 : start;
    end = Math.min(text.length, start + SNIPPET_CHARS);
    if (end < text.length) {
      const cut = text.slice(start, end).search(/\s\S*$/);
      if (cut > SNIPPET_CHARS / 2) end = start + cut;
    }
  }
  const lead = start > 0 ? "…" : "";
  const snippet = lead + text.slice(start, end) + (end < text.length ? "…" : "");
  const marks = hits
    .filter((span) => span.start >= start && span.end <= end)
    .map((span): [number, number] => [span.start - start + lead.length, span.end - start + lead.length]);
  return { snippet, marks };
};

/**
 * Okapi BM25 over every source at once, so a term's rarity is judged across the whole library and a note
 * scores on the same scale as a book's text. Each document's result points at its part with the most of the
 * query (rarest terms first), and results that land on the same place are kept once.
 */
export const searchSources = (sources: readonly SearchSource[], query: string, limit = 60): ScoredHit[] => {
  const groups = groupsOf(query);
  if (!groups.length) return [];
  const total = sources.reduce((sum, source) => sum + source.docs.length, 0);
  if (!total) return [];
  const average = sources.reduce((sum, source) => sum + source.lengths.reduce((a, b) => a + b, 0), 0) / total || 1;

  /* Per group, per source: each document's count of the group's terms. */
  const counts = groups.map((group) =>
    sources.map((source) => {
      const byDoc = new Map<number, number>();
      for (const term of group.terms(source)) for (const [doc, count] of source.postings.get(term) ?? []) byDoc.set(doc, (byDoc.get(doc) ?? 0) + count);
      return byDoc;
    }),
  );
  const idf = counts.map((perSource) => {
    const df = perSource.reduce((sum, byDoc) => sum + byDoc.size, 0);
    return Math.log(1 + (total - df + 0.5) / (df + 0.5));
  });

  const scored: { source: number; doc: number; score: number }[] = [];
  sources.forEach((source, s) => {
    const scores = new Map<number, number>();
    counts.forEach((perSource, g) => {
      for (const [doc, tf] of perSource[s]) {
        const norm = tf + K1 * (1 - B + (B * source.lengths[doc]) / average);
        scores.set(doc, (scores.get(doc) ?? 0) + (idf[g] * tf * (K1 + 1)) / norm);
      }
    });
    for (const [doc, score] of scores) scored.push({ source: s, doc, score });
  });
  scored.sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const hits: ScoredHit[] = [];
  for (const { source, doc, score } of scored) {
    if (hits.length >= limit) break;
    const { bookId, docs } = sources[source];
    const { kind, parts } = docs[doc];
    let best: { part: DocPart; spans: TokenSpan[]; weight: number; occurrences: number } | null = null;
    for (const part of parts) {
      const spans = tokenSpans(part.text);
      const weight = groups.reduce((sum, group, g) => sum + (spans.some((span) => group.matches(span.term)) ? idf[g] : 0), 0);
      const occurrences = spans.filter((span) => groups.some((group) => group.matches(span.term))).length;
      if (!best || weight > best.weight || (weight === best.weight && occurrences > best.occurrences)) best = { part, spans, weight, occurrences };
    }
    if (!best || best.weight === 0) continue;
    const key = `${bookId} ${kind} ${JSON.stringify(best.part.anchor)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const matched = (term: string) => groups.some((group) => group.matches(term));
    hits.push({ bookId, kind, anchor: best.part.anchor, chapter: best.part.chapter, score, ...snippetOf(best.part.text, best.spans, matched) });
  }
  return hits;
};

/** Results grouped by book, then chapter, each group in the order of its best result. */
export const groupHits = (hits: readonly ScoredHit[], bookOf: (id: BookId) => { title: string; format: BookFormat }): SearchBook[] => {
  const books = new Map<BookId, SearchBook>();
  for (const { bookId, chapter, kind, anchor, snippet, marks } of hits) {
    const hit: SearchHit = { kind, anchor, snippet, marks };
    let book = books.get(bookId);
    if (!book) {
      book = { id: bookId, ...bookOf(bookId), chapters: [] };
      books.set(bookId, book);
    }
    let group = book.chapters.find((entry) => entry.title === chapter);
    if (!group) {
      group = { title: chapter, hits: [] };
      book.chapters.push(group);
    }
    group.hits.push(hit);
  }
  return [...books.values()];
};
