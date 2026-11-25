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
  /** The word's stem, which is what the index stores. */
  term: string;
  /** Where the word itself is in the text, so marks highlight the book's own words. */
  start: number;
  end: number;
}

/** Folds case and accents, so "Café" and "cafe" are one term. */
const fold = (word: string) => word.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

const HAS_VOWEL = /[aeiouy]/;
/* A doubled final consonant left by -ing or -ed ("stopp", "runn") is undoubled; ll, ss and zz are kept ("fall", "miss"). */
const DOUBLED = /([bdfgmnprt])\1$/;

/* Common verbs whose -s and -ing forms the suffix rules can't reach. */
const IRREGULAR = new Map([["does", "do"], ["doing", "do"], ["goes", "go"], ["going", "go"]]);

/* A final consonant-y is written -ie, the form it takes before -s and -d, so "story", "stories", "copied" and
   "copying" meet without merging "movie" ("movies") into a "movy". */
const ieForm = (w: string) => (/[^aeiouy]y$/.test(w) ? `${w.slice(0, -1)}ie` : w);

/**
 * A light English stemmer: plurals and third-person -s, then -ing and -ed, so "stops", "stopped" and "stop" are
 * one term, and "reading", "reads" and "read". Only plain a-z words change, and -s, -ing and -ed come off only
 * words of four letters or more and never leave less than three, so short words, other scripts and numbers stay
 * as they are. It does not touch -er or a final e: "reader" stays apart from "read", and "making" from "make",
 * because those rules also merge words that differ ("letter" and "let", "care" and "car").
 */
export const stem = (word: string): string => {
  if (!/^[a-z]+$/.test(word)) return word;
  const irregular = IRREGULAR.get(word);
  if (irregular) return irregular;
  if (word.length < 4) return word.length === 3 ? ieForm(word) : word;
  let w = word;
  if (/(sses|xes|zes|ches|shes)$/.test(w)) w = w.slice(0, -2);
  else if (w.endsWith("s") && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);

  if (w.endsWith("ied") && w.length > 4) return w.slice(0, -1);
  const suffix = w.endsWith("ing") ? 3 : w.endsWith("ed") && !w.endsWith("eed") ? 2 : 0;
  const base = w.slice(0, w.length - suffix);
  if (!suffix || base.length < 3 || !HAS_VOWEL.test(base)) return ieForm(w);
  return ieForm(base.length >= 4 && DOUBLED.test(base) ? base.slice(0, -1) : base);
};

const tokenSpans = (text: string): TokenSpan[] =>
  [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({ term: stem(fold(match[0])), start: match.index, end: match.index + match[0].length }));

/** The search terms in a text: runs of letters and digits, case and accents folded, then stemmed. No stop words. */
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

/**
 * One book's documents with an inverted index: for each term, the documents it occurs in and how often, packed
 * flat as doc, count, doc, count. A typed array per term keeps a large library's index small in memory.
 */
export interface SearchSource {
  bookId: BookId;
  docs: readonly SearchDoc[];
  lengths: readonly number[];
  postings: ReadonlyMap<string, Uint32Array>;
}

export const makeSource = (bookId: BookId, docs: readonly SearchDoc[]): SearchSource => {
  const lists = new Map<string, number[]>();
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
      const list = lists.get(term);
      if (list) list.push(index, count);
      else lists.set(term, [index, count]);
    }
    return length;
  });
  const postings = new Map<string, Uint32Array>();
  for (const [term, list] of lists) postings.set(term, Uint32Array.from(list));
  return { bookId, docs, lengths, postings };
};

const K1 = 1.2;
const B = 0.75;
/** A last word this long or longer, still being typed, also matches longer words that start with it. */
const PREFIX_MIN = 3;
/* Results show two lines, so a snippet starts a little before its first match even when the part is short. */
const SNIPPET_CHARS = 200;
const SNIPPET_LEAD = 40;

/** A query term, or for a last word still being typed, every term that starts with it. */
interface TermGroup {
  matches(term: string): boolean;
  terms(source: SearchSource): string[];
}

/* The suffixes the stemmer strips, which a word being typed may be partway through. */
const TAILS = ["ing", "ed", "es", "s"];

/** The stems of every word this one becomes by finishing a suffix it may have started: "stopp" → "stopping", "readi" → "reading". */
const completions = (word: string): Set<string> => {
  const stems = new Set<string>();
  for (const tail of TAILS) {
    for (let typed = 0; typed < tail.length; typed += 1) {
      if (word.endsWith(tail.slice(0, typed))) stems.add(stem(word + tail.slice(typed)));
    }
  }
  return stems;
};

/**
 * The query's term groups, and the query as a sequence of indexes into them (for the phrase boost). The last
 * word, while it is being typed, matches terms that start with it and its own stem. When that stem is not a
 * term anywhere in the library, so the word is likely unfinished, it also matches the stems it could still become
 * ("stopp" finds "stop"). A word that is a term stays itself: "care" does not reach "car" through "cared".
 */
const groupsOf = (query: string, sources: readonly SearchSource[]): { groups: TermGroup[]; sequence: number[] } => {
  const raw = [...query.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => fold(match[0]));
  /* Only the word under the cursor is unfinished: the query ends in it, with no space after. */
  const typing = /[\p{L}\p{N}]$/u.test(query) && raw.at(-1)!.length >= PREFIX_MIN ? raw.length - 1 : -1;
  const keys = raw.map((word, i) => (i === typing ? `${word}*` : stem(word)));
  const unique = [...new Set(keys)];
  const groups = unique.map((key): TermGroup => {
    if (key.endsWith("*")) {
      const word = key.slice(0, -1);
      const wordStem = stem(word);
      const stems = sources.some((source) => source.postings.has(wordStem)) ? new Set([wordStem]) : completions(word).add(wordStem);
      const matches = (term: string) => term.startsWith(word) || stems.has(term);
      return { matches, terms: (source) => [...source.postings.keys()].filter(matches) };
    }
    return { matches: (term) => term === key, terms: (source) => (source.postings.has(key) ? [key] : []) };
  });
  return { groups, sequence: keys.map((key) => unique.indexOf(key)) };
};

/** How many of the best BM25 documents the phrase boost looks at: re-reading a document's words costs, so it is bounded. */
const PHRASE_POOL = 300;
/** A document holding the whole query, in order and adjacent, scores up to this much more (×2). */
const PHRASE_WEIGHT = 1;

/** The query's words in order, as group indexes, with each group's idf: what the phrase boost looks for. */
interface Phrase {
  groups: readonly TermGroup[];
  sequence: readonly number[];
  idf: readonly number[];
}

/**
 * The highest idf weight (summed over its words) of a run of query words that these terms hold adjacent and in
 * order. Two words at least make a run; 0 when none. Weighting by idf keeps a run of common words ("is only")
 * from counting like a run of rare ones.
 */
const runWeight = (terms: readonly string[], { groups, sequence, idf }: Phrase): number => {
  let best = 0;
  for (let p = 0; p < terms.length; p += 1) {
    for (let i = 0; i + 1 < sequence.length; i += 1) {
      let weight = 0;
      let length = 0;
      while (i + length < sequence.length && p + length < terms.length && groups[sequence[i + length]].matches(terms[p + length])) {
        weight += idf[sequence[i + length]];
        length += 1;
      }
      if (length >= 2 && weight > best) best = weight;
    }
  }
  return best;
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
  const first = hits[0]?.start ?? 0;
  if (text.length > SNIPPET_CHARS || first > SNIPPET_LEAD) {
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
 * scores on the same scale as a book's text. Each document's result points at its part with the best phrase run,
 * then the most of the query (rarest terms first), and results that land on the same place are kept once.
 */
export const searchSources = (sources: readonly SearchSource[], query: string, limit = 60): ScoredHit[] => {
  const { groups, sequence } = groupsOf(query, sources);
  if (!groups.length) return [];
  const total = sources.reduce((sum, source) => sum + source.docs.length, 0);
  if (!total) return [];
  const average = sources.reduce((sum, source) => sum + source.lengths.reduce((a, b) => a + b, 0), 0) / total || 1;

  /* Per group, per source: each document's count of the group's terms. */
  const counts = groups.map((group) =>
    sources.map((source) => {
      const byDoc = new Map<number, number>();
      for (const term of group.terms(source)) {
        const list = source.postings.get(term)!;
        for (let i = 0; i < list.length; i += 2) byDoc.set(list[i], (byDoc.get(list[i]) ?? 0) + list[i + 1]);
      }
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
  /* Phrase boost: BM25 ignores word order, so lift the best documents that hold the query's words side by side,
     by the best run in any one part over the whole query's weight. */
  const phrase: Phrase | null = sequence.length >= 2 && new Set(sequence).size >= 2 ? { groups, sequence, idf } : null;
  const phraseTotal = phrase ? sequence.reduce((sum, g) => sum + idf[g], 0) : 0;
  if (phrase && phraseTotal) {
    for (const entry of scored.slice(0, PHRASE_POOL)) {
      const run = Math.max(0, ...sources[entry.source].docs[entry.doc].parts.map((part) => runWeight(tokenize(part.text), phrase)));
      entry.score *= 1 + (PHRASE_WEIGHT * run) / phraseTotal;
    }
    scored.sort((a, b) => b.score - a.score);
  }

  const seen = new Set<string>();
  const hits: ScoredHit[] = [];
  for (const { source, doc, score } of scored) {
    if (hits.length >= limit) break;
    const { bookId, docs } = sources[source];
    const { kind, parts } = docs[doc];
    /* The result lands on the part holding the best phrase run, since that is what the boost scored, then on the
       part with the most of the query. */
    let best: { part: DocPart; spans: TokenSpan[]; run: number; weight: number; occurrences: number } | null = null;
    for (const part of parts) {
      const spans = tokenSpans(part.text);
      const run = phrase ? runWeight(spans.map((span) => span.term), phrase) : 0;
      const weight = groups.reduce((sum, group, g) => sum + (spans.some((span) => group.matches(span.term)) ? idf[g] : 0), 0);
      const occurrences = spans.filter((span) => groups.some((group) => group.matches(span.term))).length;
      const better =
        !best ||
        run > best.run ||
        (run === best.run && (weight > best.weight || (weight === best.weight && occurrences > best.occurrences)));
      if (better) best = { part, spans, run, weight, occurrences };
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
