import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { chunkRanges, groupHits, makeSource, searchSources, type DocPart, type SearchDoc, type SearchResults, type SearchSource } from "@/lib/shared/search";
import type { Anchor, BookFormat, BookId, BookState, LibraryBook } from "@/lib/shared/types";
import { getConfig } from "../config";
import { BOOK_ID_PATTERN, type IndexEntry } from "../library-index";
import { recentLibrary } from "../library";
import { readBookState, savedFiles, serialized, writeFileAtomic } from "../store";
import { epubBlocks, pdfBlocks, type TextBlock } from "./book-text";

/**
 * A book's text, split for search, in DATA_DIR/search/<book id>.json. It is derived from the book file and
 * never edited: it is rebuilt whenever the file's size or modified time differs from the fingerprint it was
 * built from, or the format below changes, so deleting it costs a rebuild and nothing else.
 */
interface StoredText {
  version: typeof VERSION;
  fingerprint: Fingerprint;
  chapters: string[];
  /** Each block's anchor, text and chapter (an index into `chapters`, or -1). */
  blocks: { a: Anchor; t: string; c: number }[];
  /** Inclusive block ranges. */
  chunks: [number, number][];
}

/* Bump when the extraction or chunking changes, so every book is read again. */
const VERSION = 1;

interface Fingerprint {
  size: number;
  mtimeMs: number;
}

const fingerprintOf = (entry: IndexEntry): Fingerprint => ({ size: entry.size, mtimeMs: entry.mtimeMs });
const versionKey = ({ size, mtimeMs }: Fingerprint) => `${VERSION}:${size}:${mtimeMs}`;

const searchDir = (dataDir: string) => path.join(/*turbopackIgnore: true*/ dataDir, "search");
export const searchFile = (dataDir: string, id: BookId) => path.join(searchDir(dataDir), `${id}.json`);

/** Reads a book's blocks and groups them into chunks, ready to store. */
export const extractText = async (absPath: string, format: BookFormat, fingerprint: Fingerprint): Promise<StoredText> => {
  const data = new Uint8Array(await readFile(absPath));
  const blocks: TextBlock[] = format === "pdf" ? await pdfBlocks(data) : epubBlocks(data);
  const chapters: string[] = [];
  const chapterIndex = new Map<string, number>();
  const stored = blocks.map((block) => {
    let c = -1;
    if (block.chapter !== null) {
      c = chapterIndex.get(block.chapter) ?? chapters.length;
      if (c === chapters.length) {
        chapters.push(block.chapter);
        chapterIndex.set(block.chapter, c);
      }
    }
    return { a: block.anchor, t: block.text, c };
  });
  return { version: VERSION, fingerprint, chapters, blocks: stored, chunks: chunkRanges(blocks) };
};

const textSource = (id: BookId, stored: StoredText): SearchSource => {
  const parts: DocPart[] = stored.blocks.map((block) => ({ text: block.t, anchor: block.a, chapter: stored.chapters[block.c] ?? null }));
  return makeSource(
    id,
    stored.chunks.map(([from, to]) => ({ kind: "text", parts: parts.slice(from, to + 1) })),
  );
};

/** What the reader saved for a book, each highlight, note and card set as one document. */
export const savedDocs = (state: BookState): SearchDoc[] => [
  ...state.highlights.map((h): SearchDoc => ({ kind: "highlight", parts: [{ text: h.quote, anchor: h.anchor, chapter: h.chapterTitle }] })),
  ...state.notes.map((note): SearchDoc => {
    const at = { anchor: note.anchor, chapter: note.chapterTitle };
    return { kind: "note", parts: [{ text: note.body, ...at }, { text: note.quote, ...at }, { text: note.tags.join(" "), ...at }] };
  }),
  ...state.cardSets.map((set): SearchDoc => {
    const at = { anchor: set.anchor, chapter: set.chapterTitle };
    return {
      kind: "card",
      parts: [{ text: set.fact, ...at }, ...set.cues.map((cue) => ({ text: `${cue.question} ${cue.answer}`, ...at })), { text: set.quote, ...at }],
    };
  }),
];

interface Loaded {
  key: string;
  /** The index file's modified time when it was loaded, so a file deleted or replaced on disk is read again. */
  fileMtimeMs: number;
  source: SearchSource;
}

interface Saved {
  mtimeMs: number;
  title: string | null;
  source: SearchSource;
}

/** One book the builder should have in the index, as the latest search saw it. */
interface Wanted {
  book: LibraryBook;
  absPath: string;
  fingerprint: Fingerprint;
}

/**
 * Per data folder: loaded indexes, saved data read for search, books that failed to read, and the builder.
 * On globalThis, because the dev server loads this module once per route.
 */
interface Library {
  texts: Map<BookId, Loaded>;
  /** The version key last looked for on disk and not found, so a stale file is not read again on every keystroke. */
  missing: Map<BookId, string>;
  failed: Map<BookId, string>;
  saved: Map<BookId, Saved>;
  wanted: Map<BookId, Wanted>;
  known: Set<BookId>;
  run: Promise<void> | null;
}

const libraries = ((globalThis as { [key: symbol]: unknown })[Symbol.for("margo.search")] ??= new Map()) as Map<string, Library>;

const libraryFor = (dataDir: string): Library => {
  let library = libraries.get(dataDir);
  if (!library) {
    library = { texts: new Map(), missing: new Map(), failed: new Map(), saved: new Map(), wanted: new Map(), known: new Set(), run: null };
    libraries.set(dataDir, library);
  }
  return library;
};

const isStored = (value: unknown, key: string): value is StoredText => {
  const stored = value as StoredText | null;
  return (
    !!stored &&
    stored.version === VERSION &&
    typeof stored.fingerprint === "object" &&
    versionKey(stored.fingerprint) === key &&
    Array.isArray(stored.chapters) &&
    Array.isArray(stored.blocks) &&
    Array.isArray(stored.chunks)
  );
};

/** The book's index if it is in memory or on disk for this version of its file, else null. */
const readyText = async (library: Library, dataDir: string, id: BookId, fingerprint: Fingerprint): Promise<SearchSource | null> => {
  const key = versionKey(fingerprint);
  const file = searchFile(dataDir, id);
  const fileMtimeMs = await stat(file).then(
    (info) => info.mtimeMs,
    () => null,
  );
  const loaded = library.texts.get(id);
  if (loaded?.key === key && loaded.fileMtimeMs === fileMtimeMs) return loaded.source;
  library.texts.delete(id);
  if (fileMtimeMs === null || library.missing.get(id) === `${key}@${fileMtimeMs}`) return null;
  let stored: unknown = null;
  try {
    stored = JSON.parse(await readFile(file, "utf8"));
  } catch {}
  if (!isStored(stored, key)) {
    library.missing.set(id, `${key}@${fileMtimeMs}`);
    return null;
  }
  const source = textSource(id, stored);
  library.texts.set(id, { key, fileMtimeMs, source });
  return source;
};

const build = async (library: Library, dataDir: string, id: BookId, wanted: Wanted) => {
  const key = versionKey(wanted.fingerprint);
  const file = searchFile(dataDir, id);
  try {
    const stored = await extractText(wanted.absPath, wanted.book.format, wanted.fingerprint);
    const fileMtimeMs = await serialized(file, async () => {
      await writeFileAtomic(file, JSON.stringify(stored));
      return (await stat(file)).mtimeMs;
    });
    library.texts.set(id, { key, fileMtimeMs, source: textSource(id, stored) });
    library.missing.delete(id);
  } catch (error) {
    library.failed.set(id, key);
    console.warn(`Could not index ${wanted.book.relPath} for search:`, error);
  }
};

/** Deletes the index of every book the library no longer knows, missing books' included. */
const dropOrphans = async (library: Library, dataDir: string) => {
  const name = new RegExp(`^(${BOOK_ID_PATTERN})\\.json$`);
  const names = await readdir(searchDir(dataDir)).catch(() => [] as string[]);
  for (const entry of names) {
    const id = name.exec(entry)?.[1] as BookId | undefined;
    if (!id || library.known.has(id)) continue;
    const file = searchFile(dataDir, id);
    await serialized(file, () => rm(file, { force: true }));
    library.texts.delete(id);
  }
};

const pending = (library: Library): [BookId, Wanted][] =>
  [...library.wanted].filter(([id, wanted]) => {
    const key = versionKey(wanted.fingerprint);
    return library.texts.get(id)?.key !== key && library.failed.get(id) !== key;
  });

/**
 * Builds every wanted book's index that is missing or stale, one book at a time, off the request path. One
 * run per data folder; calling it while one runs returns that run, which picks up books wanted since.
 */
const runBuilder = (library: Library, dataDir: string): Promise<void> => {
  if (library.run) return library.run;
  const run = (async () => {
    try {
      for (let next = pending(library)[0]; next; next = pending(library)[0]) {
        const [id, wanted] = next;
        /* Another process may have written it since the last look. */
        if (!(await readyText(library, dataDir, id, wanted.fingerprint))) {
          library.missing.delete(id);
          await build(library, dataDir, id, wanted);
        }
      }
      await dropOrphans(library, dataDir);
    } catch (error) {
      console.warn("Stopped indexing books for search:", error);
    } finally {
      library.run = null;
    }
  })();
  library.run = run;
  return run;
};

/** A book's highlights, notes and cards as a search source, read again only when its state file changed. */
const savedSource = async (library: Library, dataDir: string, id: BookId): Promise<Saved | null> => {
  const [stateFile] = savedFiles(id, dataDir);
  const mtimeMs = await stat(stateFile).then(
    (info) => info.mtimeMs,
    () => null,
  );
  if (mtimeMs === null) {
    library.saved.delete(id);
    return null;
  }
  const cached = library.saved.get(id);
  if (cached?.mtimeMs === mtimeMs) return cached;
  const state = await readBookState(id, dataDir).catch(() => null);
  if (!state) return null;
  const saved = { mtimeMs, title: state.meta?.title || null, source: makeSource(id, savedDocs(state)) };
  library.saved.set(id, saved);
  return saved;
};

/**
 * Searches every book's text, highlights, notes and cards. Books whose index is not built yet are queued for
 * the background builder and searched by what the reader saved for them until it is; `indexing` says how
 * far it has got. An empty query only starts the builder.
 */
export const searchLibrary = async (
  query: string,
  { root = getConfig().booksDir, dataDir = getConfig().dataDir }: { root?: string; dataDir?: string } = {},
): Promise<SearchResults & { building: Promise<void> | null }> => {
  const scan = await recentLibrary(root, dataDir);
  const library = libraryFor(dataDir);
  library.known = new Set(Object.keys(scan.index) as BookId[]);
  library.wanted = new Map(
    scan.books.map((book) => [book.id, { book, absPath: path.resolve(/*turbopackIgnore: true*/ root, book.relPath), fingerprint: fingerprintOf(scan.index[book.id]) }]),
  );

  const titles = new Map<BookId, string>();
  let ready = 0;
  let failed = 0;
  /* In library order, so equal scores always rank the same way. */
  const perBook = await Promise.all(
    scan.books.map(async (book) => {
      const { fingerprint } = library.wanted.get(book.id)!;
      const [text, saved] = await Promise.all([readyText(library, dataDir, book.id, fingerprint), savedSource(library, dataDir, book.id)]);
      if (text) ready += 1;
      else if (library.failed.get(book.id) === versionKey(fingerprint)) failed += 1;
      titles.set(book.id, saved?.title || book.fileTitle);
      return [text, saved?.source ?? null];
    }),
  );
  const sources = perBook.flat().filter((source): source is SearchSource => source !== null);
  const building = pending(library).length ? runBuilder(library, dataDir) : library.run;

  const formats = new Map(scan.books.map((book) => [book.id, book.format]));
  const hits = query.trim() ? searchSources(sources, query) : [];
  return {
    books: groupHits(hits, (id) => ({ title: titles.get(id) ?? "", format: formats.get(id) ?? "epub" })),
    indexing: { ready, total: scan.books.length, failed },
    building,
  };
};

/** A book's text in reading order, each block with its chapter label from the table of contents. */
export interface BookText {
  chapters: string[];
  blocks: { anchor: Anchor; text: string; chapter: string | null }[];
}

const asBookText = (stored: StoredText): BookText => ({
  chapters: stored.chapters,
  blocks: stored.blocks.map((block) => ({ anchor: block.a, text: block.t, chapter: stored.chapters[block.c] ?? null })),
});

/**
 * A book's text, from its search file when that is current for the book file. With `extract`, a missing or stale
 * file is read from the book now and stored, which can take seconds; without, it answers null instead.
 */
export const bookText = async (
  id: BookId,
  { extract, root = getConfig().booksDir, dataDir = getConfig().dataDir }: { extract: boolean; root?: string; dataDir?: string },
): Promise<BookText | null> => {
  const scan = await recentLibrary(root, dataDir);
  const book = scan.books.find((candidate) => candidate.id === id);
  const entry = scan.index[id];
  if (!book || !entry) return null;
  const fingerprint = fingerprintOf(entry);
  const file = searchFile(dataDir, id);
  let stored: unknown = null;
  try {
    stored = JSON.parse(await readFile(file, "utf8"));
  } catch {}
  if (isStored(stored, versionKey(fingerprint))) return asBookText(stored);
  if (!extract) return null;
  const fresh = await extractText(path.resolve(/*turbopackIgnore: true*/ root, book.relPath), book.format, fingerprint);
  await serialized(file, () => writeFileAtomic(file, JSON.stringify(fresh)));
  return asBookText(fresh);
};
