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
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
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

export interface AppSettings {
  provider: ProviderId | null;
  models: Partial<Record<ProviderId, string>>;
}

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
