import { firstObject } from "./json";
import type { BookId, ProviderId } from "./types";

/** A book a Course reads. `bookId` is set when the library has it; otherwise it is still to find. */
export interface CourseBook {
  /** The roadmap's own name for the book, which readings point at. */
  key: string;
  title: string;
  author: string | null;
  edition: string | null;
  bookId: BookId | null;
}

/**
 * A chapter to read. When the book is in the library and the chapter was found in its table of contents, `title`
 * is that table's own label, the same one the reader reports, and `inBook` is true. Otherwise it is the tutor's
 * name for it.
 */
export interface CourseChapter {
  title: string;
  inBook: boolean;
}

export interface CourseReading {
  book: string;
  chapters: CourseChapter[];
}

export interface CourseUnit {
  title: string;
  concepts: string[];
  /** Rough weeks the unit takes at the Course's weekly time, or null when the tutor gave none. */
  weeks: number | null;
  readings: CourseReading[];
}

/** What the tutor proposes in the planning chat, matched against the library. */
export interface Roadmap {
  name: string;
  goal: string;
  level: string;
  weeklyHours: number | null;
  /** The rough timeline in words, such as "about 10 weeks". */
  timeline: string | null;
  books: CourseBook[];
  units: CourseUnit[];
}

export interface Course extends Roadmap {
  id: string;
  /** The planning chat it came from; approving there again updates this Course. */
  planId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  partial?: boolean;
  /** On an answer that proposed a roadmap. */
  roadmap?: Roadmap;
}

/** The home chat that plans a Course. */
export interface Plan {
  id: string;
  provider: ProviderId;
  sessionId: string | null;
  messages: PlanMessage[];
  courseId: string | null;
  createdAt: string;
}

/** DATA_DIR/courses.json. */
export interface CoursesFile {
  courses: Course[];
  plans: Plan[];
}

export const emptyCourses = (): CoursesFile => ({ courses: [], plans: [] });

/** What the planner knows about a library book. `chapters` is null when its text has not been read yet. */
export interface LibraryEntry {
  id: BookId;
  title: string;
  author: string | null;
  chapters: string[] | null;
}

/** The fence an answer puts its roadmap in. */
export const ROADMAP_FENCE = /```roadmap\s*\n([\s\S]*?)(?:\n```|$)/;

/** The answer's words without its roadmap fence, for showing. */
export const withoutRoadmap = (text: string): string => text.replace(ROADMAP_FENCE, "").trim();

const LIMITS = { units: 16, books: 16, chapters: 40, concepts: 12, text: 300 } as const;

const text = (value: unknown, max: number = LIMITS.text): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

const texts = (value: unknown, max: number): string[] =>
  Array.isArray(value) ? value.map((item) => text(item)).filter((item): item is string => item !== null).slice(0, max) : [];

const positive = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value * 10) / 10 : null);

/** The roadmap as the tutor wrote it, before any matching. */
export interface DraftRoadmap extends Omit<Roadmap, "books" | "units"> {
  books: { key: string; libraryId: string | null; title: string; author: string | null; edition: string | null }[];
  units: { title: string; concepts: string[]; weeks: number | null; readings: { book: string; chapters: string[] }[] }[];
}

/**
 * Reads the roadmap fence of an answer. Returns null when the answer has none, and a reason to send back when it
 * has one that can't be used.
 */
export const parseRoadmap = (answer: string): DraftRoadmap | string | null => {
  const fence = ROADMAP_FENCE.exec(answer);
  if (!fence) return null;
  const json = firstObject(fence[1]);
  if (!json) return "The roadmap block had no JSON object.";
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    return `The roadmap JSON did not parse: ${error instanceof Error ? error.message : "unknown error"}.`;
  }
  if (!value || typeof value !== "object") return "The roadmap was not a JSON object.";
  const raw = value as Record<string, unknown>;
  const name = text(raw.name);
  const goal = text(raw.goal, 600);
  if (!name || !goal) return 'The roadmap needs a "name" and a "goal".';
  if (!Array.isArray(raw.books) || !raw.books.length) return 'The roadmap needs a non-empty "books" list.';
  if (!Array.isArray(raw.units) || !raw.units.length) return 'The roadmap needs a non-empty "units" list.';

  const books: DraftRoadmap["books"] = [];
  for (const item of raw.books.slice(0, LIMITS.books)) {
    const book = (item ?? {}) as Record<string, unknown>;
    const key = text(book.key, 40);
    const title = text(book.title);
    if (!key || !title) return 'Every book needs a "key" and a "title".';
    if (books.some((b) => b.key === key)) return `Two books share the key "${key}".`;
    books.push({ key, title, libraryId: text(book.libraryId, 80), author: text(book.author), edition: text(book.edition) });
  }

  const units: DraftRoadmap["units"] = [];
  for (const item of raw.units.slice(0, LIMITS.units)) {
    const unit = (item ?? {}) as Record<string, unknown>;
    const title = text(unit.title);
    if (!title) return 'Every unit needs a "title".';
    const readings: DraftRoadmap["units"][number]["readings"] = [];
    for (const reading of Array.isArray(unit.readings) ? unit.readings : []) {
      const r = (reading ?? {}) as Record<string, unknown>;
      const book = text(r.book, 40);
      if (!book || !books.some((b) => b.key === book)) return `A reading in "${title}" names a book key that isn't in "books".`;
      readings.push({ book, chapters: texts(r.chapters, LIMITS.chapters) });
    }
    units.push({ title, concepts: texts(unit.concepts, LIMITS.concepts), weeks: positive(unit.weeks), readings });
  }

  return {
    name,
    goal,
    level: text(raw.level) ?? "Not stated",
    weeklyHours: positive(raw.weeklyHours),
    timeline: text(raw.timeline),
    books,
    units,
  };
};

/** Letters and digits only, lowercased, so punctuation, case and spacing don't matter. */
export const squashed = (value: string) => value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** How alike two names are, from 0 to 1: the Dice coefficient of their letter pairs. */
export const similarity = (a: string, b: string): number => {
  const left = squashed(a);
  const right = squashed(b);
  if (left === right) return left ? 1 : 0;
  const pairs = new Map<string, number>();
  for (let i = 0; i < left.length - 1; i++) pairs.set(left.slice(i, i + 2), (pairs.get(left.slice(i, i + 2)) ?? 0) + 1);
  let shared = 0;
  for (let i = 0; i < right.length - 1; i++) {
    const pair = right.slice(i, i + 2);
    const count = pairs.get(pair) ?? 0;
    if (count) {
      shared++;
      pairs.set(pair, count - 1);
    }
  }
  const total = left.length - 1 + right.length - 1;
  return total > 0 ? (2 * shared) / total : 0;
};

/* A subtitle or series name after a colon or dash doesn't make a different book. */
const mainTitle = (title: string) => title.split(/[:(]| [-–—] /)[0];

/** The library book a planned title names, if any. */
export const matchBook = (planned: { title: string; author: string | null }, library: readonly LibraryEntry[]): LibraryEntry | null => {
  let best: LibraryEntry | null = null;
  let bestScore = 0;
  for (const entry of library) {
    const score = Math.max(similarity(planned.title, entry.title), similarity(mainTitle(planned.title), mainTitle(entry.title)));
    if (score > bestScore) [best, bestScore] = [entry, score];
  }
  return bestScore >= 0.85 ? best : null;
};

/**
 * The book's own label for a planned chapter: the same label, or one that starts with it ("Chapter 3" for
 * "Chapter 3: Outcomes"), or failing that the closest one. Null when nothing is close.
 */
export const matchChapter = (planned: string, chapters: readonly string[]): string | null => {
  const want = squashed(planned);
  if (!want) return null;
  const exact = chapters.find((chapter) => squashed(chapter) === want);
  if (exact) return exact;
  const prefixed = chapters.filter((chapter) => {
    const have = squashed(chapter);
    return have.length > 0 && (have.startsWith(want) || want.startsWith(have)) && Math.min(have.length, want.length) >= 6;
  });
  if (prefixed.length === 1) return prefixed[0];
  let best: string | null = null;
  let bestScore = 0;
  for (const chapter of chapters) {
    const score = similarity(planned, chapter);
    if (score > bestScore) [best, bestScore] = [chapter, score];
  }
  return bestScore >= 0.75 ? best : null;
};

/**
 * Matches a drafted roadmap against the library: each book to the library book it names, by the id the tutor
 * was given or failing that by title, and each chapter of a book that is there to that book's own label.
 */
export const resolveRoadmap = (draft: DraftRoadmap, library: readonly LibraryEntry[]): Roadmap => {
  const byId = new Map(library.map((entry) => [entry.id as string, entry]));
  const found = new Map<string, LibraryEntry | null>();
  const books: CourseBook[] = draft.books.map((book) => {
    const entry = (book.libraryId && byId.get(book.libraryId)) || matchBook(book, library);
    found.set(book.key, entry ?? null);
    return {
      key: book.key,
      title: entry?.title ?? book.title,
      author: entry ? (entry.author ?? book.author) : book.author,
      edition: book.edition,
      bookId: entry?.id ?? null,
    };
  });
  const units: CourseUnit[] = draft.units.map((unit) => ({
    title: unit.title,
    concepts: unit.concepts,
    weeks: unit.weeks,
    readings: unit.readings.map((reading) => {
      const chapters = found.get(reading.book)?.chapters ?? null;
      const seen = new Set<string>();
      return {
        book: reading.book,
        chapters: reading.chapters.flatMap((title) => {
          const label = chapters && matchChapter(title, chapters);
          const chapter = label ? { title: label, inBook: true } : { title, inBook: false };
          if (seen.has(chapter.title)) return [];
          seen.add(chapter.title);
          return [chapter];
        }),
      };
    }),
  }));
  return { name: draft.name, goal: draft.goal, level: draft.level, weeklyHours: draft.weeklyHours, timeline: draft.timeline, books, units };
};

/** One chapter of a library book a Course reads, in Course order. */
export interface CourseStep {
  bookId: BookId;
  chapter: string;
  unit: number;
}

/** Every found chapter of every library book in the Course, in the order the units read them, each once. */
export const courseSteps = (course: Pick<Roadmap, "books" | "units">): CourseStep[] => {
  const ids = new Map(course.books.map((book) => [book.key, book.bookId]));
  const seen = new Set<string>();
  const steps: CourseStep[] = [];
  course.units.forEach((unit, index) => {
    for (const reading of unit.readings) {
      const bookId = ids.get(reading.book);
      if (!bookId) continue;
      for (const chapter of reading.chapters) {
        const key = `${bookId}\n${chapter.title}`;
        if (!chapter.inBook || seen.has(key)) continue;
        seen.add(key);
        steps.push({ bookId, chapter: chapter.title, unit: index });
      }
    }
  });
  return steps;
};

/** One line of the /api/plans response stream (newline-delimited JSON). */
export type PlanStreamEvent =
  | { type: "plan"; plan: Plan }
  | { type: "text"; delta: string }
  /** The roadmap didn't parse and went back to the tutor once. */
  | { type: "fixing" }
  | { type: "error"; message: string }
  | { type: "done"; plan: Plan };
