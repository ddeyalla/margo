export type BookFormat = "epub" | "pdf";

/** sha1 of the book's path relative to BOOKS_DIR, hex. */
export type BookId = string & { readonly __brand: "BookId" };

export interface LibraryBook {
  id: BookId;
  format: BookFormat;
  relPath: string;
  folder: string;
  fileTitle: string;
  /** The author read from the file name, for books whose metadata has none or that were never opened. */
  fileAuthor: string | null;
  sizeBytes: number;
  modifiedAt: string;
}

export type Anchor =
  | { kind: "epub"; cfi: string }
  | { kind: "pdf"; page: number; start: number; end: number };

/** A reading position. PDF positions carry no character range, only a page and a fraction scrolled into it. */
export type Position =
  | { kind: "epub"; cfi: string; fraction: number }
  | { kind: "pdf"; page: number; offset: number; fraction: number };

export interface SelectionContext {
  text: string;
  before: string;
  after: string;
  anchor: Anchor;
  chapterTitle: string | null;
  rect: { top: number; left: number; width: number; height: number };
}

export interface BookMeta {
  title: string;
  author: string | null;
  format: BookFormat;
  relPath: string;
}

export type ProviderId = "claude" | "codex" | "api";

export type TutorAction = "explain" | "deeper" | "ask";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  partial?: boolean;
}

export interface Thread {
  id: string;
  anchor: Anchor;
  quote: string;
  before: string;
  after: string;
  chapterTitle: string | null;
  action: TutorAction;
  provider: ProviderId;
  sessionId: string | null;
  createdAt: string;
  messages: ChatMessage[];
}

export type HighlightColor = "amber";

export interface Highlight {
  id: string;
  anchor: Anchor;
  quote: string;
  chapterTitle: string | null;
  color: HighlightColor;
  createdAt: string;
}

export interface Note {
  id: string;
  anchor: Anchor;
  quote: string;
  chapterTitle: string | null;
  /** The highlight that marks this note's passage, or null once that highlight is removed. */
  highlightId: string | null;
  /** Markdown. */
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** What happened to the markdown copy in NOTES_DIR after the last change. */
export type VaultStatus =
  | { state: "written"; file: string }
  | { state: "off" }
  | { state: "failed"; error: string };

export interface Annotations {
  highlights: Highlight[];
  notes: Note[];
}

export interface Card {
  id: string;
  anchor: Anchor;
  quote: string;
  createdAt: string;
}

export interface BookState {
  meta: BookMeta | null;
  position: Position | null;
  threads: Thread[];
  highlights: Highlight[];
  notes: Note[];
  cards: Card[];
}

export const emptyBookState = (): BookState => ({
  meta: null,
  position: null,
  threads: [],
  highlights: [],
  notes: [],
  cards: [],
});

/** How the reader lays out a book: one continuous column, or a page at a time. */
export type ReadingMode = "scroll" | "pages";

export const isReadingMode = (value: unknown): value is ReadingMode => value === "scroll" || value === "pages";

/** The colours of an EPUB's page: light text on dark, or dark ink on a warm light page. */
export type ReadingTheme = "dark" | "light";

export const isReadingTheme = (value: unknown): value is ReadingTheme => value === "dark" || value === "light";

export interface AppSettings {
  provider: ProviderId | null;
  models: Partial<Record<ProviderId, string>>;
  /** Show white PDF pages as dark pages. On unless turned off. */
  pdfDarkPages: boolean;
  readingMode: ReadingMode;
  epubTheme: ReadingTheme;
}

/** The settings the app itself changes. */
export type SettingsChange = Partial<Pick<AppSettings, "provider" | "pdfDarkPages" | "readingMode" | "epubTheme">>;

export type ProviderStatus = "ready" | "needs-auth" | "missing" | "unavailable";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  status: ProviderStatus;
  detail: string | null;
  version: string | null;
}

/** One line of the /api/chat response stream (newline-delimited JSON). */
export type ChatStreamEvent =
  | { type: "thread"; thread: Thread }
  | { type: "text"; delta: string }
  | { type: "error"; message: string }
  | { type: "done"; thread: Thread };
