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

export type TutorAction = "explain" | "deeper" | "work" | "ask" | "explainBack";

/** Actions whose first message is what the reader typed, not a fixed line. */
export type TypedAction = "ask" | "explainBack";

export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/** An image the reader gave the tutor. The file is data/attachments/<book id>/<id>.<ext>. */
export interface ImageAttachment {
  id: string;
  mediaType: ImageMediaType;
  width: number;
  height: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  partial?: boolean;
  attachments?: ImageAttachment[];
}

interface ThreadBase {
  id: string;
  provider: ProviderId;
  sessionId: string | null;
  createdAt: string;
  messages: ChatMessage[];
}

/** A thread about a passage the reader selected. */
export interface PassageThread extends ThreadBase {
  kind: "passage";
  anchor: Anchor;
  quote: string;
  before: string;
  after: string;
  chapterTitle: string | null;
  action: TutorAction;
}

/** A question asked with no passage selected, such as one about an image. */
export interface GeneralThread extends ThreadBase {
  kind: "general";
  /** Where the reader was when they asked, or null if the book had not reported a place yet. */
  anchor: Anchor | null;
  chapterTitle: string | null;
}

export type Thread = PassageThread | GeneralThread;

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

/** How well the reader recalled a card, from forgot to effortless. */
export type Rating = "again" | "hard" | "good" | "easy";

export const RATINGS: readonly Rating[] = ["again", "hard", "good", "easy"];

export const isRating = (value: unknown): value is Rating => RATINGS.includes(value as Rating);

export type ScheduleState = "new" | "learning" | "review" | "relearning";

/** When a card set comes back, and the memory model behind it. Dates are ISO strings. */
export interface Schedule {
  state: ScheduleState;
  due: string;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  /** Which learning or relearning step the set is on. */
  learningSteps: number;
  /** Times rated. A rating is applied only when it names the count the reader saw. */
  reps: number;
  lapses: number;
  lastReview: string | null;
}

/** One question that makes the reader recall the set's fact. */
export interface Cue {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
  lastRating: Rating | null;
}

/** The cards made from one passage: one fact, a few ways to recall it, one schedule. */
export interface CardSet {
  id: string;
  anchor: Anchor;
  quote: string;
  chapterTitle: string | null;
  fact: string;
  cues: Cue[];
  schedule: Schedule;
  /** The cue a set in learning or relearning keeps showing until it graduates. */
  learningCueId: string | null;
  /** The study day of the set's first rating, which counts against that day's new limit. */
  introducedOn: string | null;
  createdAt: string;
}

export interface BookState {
  meta: BookMeta | null;
  position: Position | null;
  threads: Thread[];
  /** The tutor thread the reader last had open, or null for the list of threads. */
  activeThreadId: string | null;
  highlights: Highlight[];
  notes: Note[];
  cardSets: CardSet[];
}

export const emptyBookState = (): BookState => ({
  meta: null,
  position: null,
  threads: [],
  activeThreadId: null,
  highlights: [],
  notes: [],
  cardSets: [],
});

/** How the reader lays out a book: one continuous column, or a page at a time. */
export type ReadingMode = "scroll" | "pages";

export const isReadingMode = (value: unknown): value is ReadingMode => value === "scroll" || value === "pages";

/** The colours of an EPUB's page: light text on dark, or dark ink on a warm light page. */
export type ReadingTheme = "dark" | "light";

export const isReadingTheme = (value: unknown): value is ReadingTheme => value === "dark" || value === "light";

/** A font family installed on this computer, chosen for EPUB text. null is the bundled Literata. */
export type ReadingFont = string | null;

/** A family name the reader could have picked: a short line of text, or null for Literata. */
export const isReadingFont = (value: unknown): value is ReadingFont =>
  value === null || (typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value && !/\p{Cc}/u.test(value));

/** The tab showing in the side panel. */
export type PanelTab = "chat" | "notes" | "highlights" | "cards";

export const isPanelTab = (value: unknown): value is PanelTab => value === "chat" || value === "notes" || value === "highlights" || value === "cards";

export interface AppSettings {
  provider: ProviderId | null;
  models: Partial<Record<ProviderId, string>>;
  /** Show white PDF pages as dark pages. On unless turned off. */
  pdfDarkPages: boolean;
  readingMode: ReadingMode;
  epubTheme: ReadingTheme;
  /** Set the start of each word in EPUB text in bold. Off unless turned on. */
  boldStarts: boolean;
  readingFont: ReadingFont;
  /** The chapters column beside the book. Closed unless opened. */
  chaptersOpen: boolean;
  panelTab: PanelTab;
}

/** The settings the app itself changes. */
export type SettingsChange = Partial<Pick<AppSettings, "provider" | "pdfDarkPages" | "readingMode" | "epubTheme" | "boldStarts" | "readingFont" | "chaptersOpen" | "panelTab">>;

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
