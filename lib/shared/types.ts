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

/** What is saved for a book, counted for the reader before they relink or forget it. */
export interface SavedSummary {
  highlights: number;
  notes: number;
  cardSets: number;
  threads: number;
  hasPosition: boolean;
}

/** A book with saved data whose file no scan finds any more. Fields are null when nothing records them. */
export interface MissingBook {
  id: BookId;
  title: string;
  format: BookFormat | null;
  /** Where the file was last seen, relative to the books folder. */
  relPath: string | null;
  sizeBytes: number | null;
  /** When a scan first failed to find it, in ms since the epoch. */
  missingSince: number | null;
  /** Null when the state file is there but can't be read. */
  saved: SavedSummary | null;
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

export type TutorAction = "explain" | "deeper" | "work" | "ask" | "explainBack" | "recap";

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

/**
 * A passage of the book the reader quoted into a message, such as a highlight. The tutor cites it by its number in
 * the thread, and a citation finds it again from its anchor; the text is what was quoted, kept in case it can't.
 */
export interface QuotedPassage {
  anchor: Anchor;
  text: string;
  chapterTitle: string | null;
}

/**
 * The tokens behind one answer, as its provider reported them. Nothing here is estimated: a provider that reports
 * no usage leaves the answer without any, and a figure it doesn't give is null.
 */
export interface TurnUsage {
  provider: ProviderId;
  model: string | null;
  /** "turn": this answer's own counts. "session": Codex reports its session's running total instead. */
  scope: "turn" | "session";
  /** The session a "session" total runs over, so two totals from one session can be told apart. */
  sessionId: string | null;
  /** "session": the cost is the session's running total, as Claude Code reports it on a resumed session. */
  costScope: "turn" | "session";
  /** Input read at full price, read from the cache, and written to it. */
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  /** How big the conversation was for this answer: what the model read on its last call plus what it wrote. */
  contextTokens: number | null;
  contextWindow: number | null;
  costUsd: number | null;
  /** "api": what the API charges for these tokens. "list": the same rates, for a reader whose plan pays instead. */
  costBasis: "api" | "list" | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  partial?: boolean;
  attachments?: ImageAttachment[];
  /** On the reader's message, the passages they quoted. Numbered across the thread, from 1, in the order quoted. */
  quotes?: QuotedPassage[];
  /** On an answer, when its provider reported usage. */
  usage?: TurnUsage;
  /** On an answer, set once its broken diagrams went back to the tutor, so they go back only once. */
  diagramsRepaired?: boolean;
}

/**
 * Earlier turns of a long thread, folded into one summary for the tutor. Only what goes to the model is shorter:
 * the thread keeps every message, and the reader still reads them all.
 */
export interface Compaction {
  summary: string;
  /** Messages from this index on go to the tutor as written; those between the first and this one are in the summary. */
  keepFrom: number;
  createdAt: string;
  /** What writing each summary so far used, oldest first. */
  usage: TurnUsage[];
}

interface ThreadBase {
  id: string;
  provider: ProviderId;
  sessionId: string | null;
  createdAt: string;
  messages: ChatMessage[];
  compaction?: Compaction;
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
  /**
   * Set while the question waits unsent: the reader parked it to ask later. The thread holds the question as its one
   * message and no answer. Sending it clears this. Absent on threads saved before parking existed.
   */
  parkedAt?: string | null;
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

/**
 * What the reader said before they saw an answer: how sure they were, from 0 to 100, and what they were thinking.
 * Either can be skipped, which is stored as null.
 */
export interface Stance {
  confidence: number | null;
  thinking: string | null;
}

/** One rating of a card set, kept so confidence can be read back: a right answer at 30 % is not one at 100 %. */
export interface ReviewRecord extends Stance {
  at: string;
  cueId: string;
  rating: Rating;
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
  /** The latest ratings, oldest first, at most `HISTORY_LIMIT`. Absent on sets saved before it was kept. */
  history?: ReviewRecord[];
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
  /** When the reader last moved through the book, an ISO time, or null if never or saved before this was kept. */
  lastReadAt: string | null;
}

export const emptyBookState = (): BookState => ({
  meta: null,
  position: null,
  threads: [],
  activeThreadId: null,
  highlights: [],
  notes: [],
  cardSets: [],
  lastReadAt: null,
});

/** How the reader lays out a book: one continuous column, or a page at a time. */
export type ReadingMode = "scroll" | "pages";

export const isReadingMode = (value: unknown): value is ReadingMode => value === "scroll" || value === "pages";

/** The colours of a book's page: the app's light or dark theme, or always one of them. */
export type ReadingTheme = "auto" | "dark" | "light";

export const isReadingTheme = (value: unknown): value is ReadingTheme => value === "auto" || value === "dark" || value === "light";

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
  /** Dark shows white PDF pages dark; light shows pages in their own colours. Auto follows the app's theme. */
  pdfPage: ReadingTheme;
  readingMode: ReadingMode;
  epubPage: ReadingTheme;
  /** Set the start of each word in EPUB text in bold. Off unless turned on. */
  boldStarts: boolean;
  readingFont: ReadingFont;
  /** The chapters column beside the book. Closed unless opened. */
  chaptersOpen: boolean;
  panelTab: PanelTab;
  /** Absolute folder of books and of the markdown notes copy, chosen in the app. BOOKS_DIR and NOTES_DIR win over them. */
  booksDir: string | null;
  notesDir: string | null;
}

/** The settings the app itself changes. */
export type SettingsChange = Partial<Pick<AppSettings, "provider" | "models" | "pdfPage" | "readingMode" | "epubPage" | "boldStarts" | "readingFont" | "chaptersOpen" | "panelTab" | "booksDir" | "notesDir">>;

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
  /** The tutor is summarizing the thread's older turns before it answers. */
  | { type: "compacting" }
  | { type: "text"; delta: string }
  | { type: "error"; message: string }
  | { type: "done"; thread: Thread };
