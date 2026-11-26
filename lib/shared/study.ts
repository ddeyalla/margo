import type { ChatMessage, PassageThread, Thread } from "./types";
import { isJustTellMe, MAX_HINTS, replies } from "./work";

/** How an answer was judged. */
export type Verdict = "right" | "partly" | "wrong";

/** The reader's own call on an answer, which stands over the grader's. */
export type Overrule = "right" | "wrong";

/** One answer the reader gave in Go deeper, and how it was judged. */
export interface LearnerTurn {
  at: string;
  answer: string;
  verdict: Verdict;
  /** From 0 to 1. */
  score: number;
  /** The grader would not stand behind the verdict, so the reader is shown the gap and decides. */
  unsure: boolean;
  /** The first point the answer missed, the stretch of the passage that shows it, and what was off. Null when nothing was. */
  gap: { point: string; span: string; note: string } | null;
  /** Hints the reader had asked for in this thread by the time they answered. */
  hintsUsed: number;
  /** Set when the reader overruled the grade. */
  override: Overrule | null;
}

/**
 * The reader's turn on a passage, in the Go deeper sheet. "guess": a question to try before any explanation.
 * "explainBack": the passage in their own words, for one they have already asked about.
 */
export interface Study {
  mode: "guess" | "explainBack";
  question: string;
  /** What a right answer says, kept from the reader until they answer. Null when the passage itself is the answer. */
  expected: string | null;
  /** The points a right answer must make, kept from the first grade so a second try is marked against the same ones. */
  rubric: string[] | null;
  /** An answer the reader left unfinished when they closed the sheet. */
  draft: string;
  /** Oldest first. */
  turns: LearnerTurn[];
}

export type StudyThread = PassageThread & { study: Study };

export const isStudy = (thread: Thread | null | undefined): thread is StudyThread => thread?.kind === "passage" && !!thread.study;

export const EXPLAIN_BACK_QUESTION = "Explain this passage in your own words: what is it saying, and why?";

export const MAX_ANSWER = 8_000;

/**
 * The reader's button presses in a study, "Hint n" and "Just tell me", as indexes into the thread's messages. An
 * answer they typed is a user message too, saved at its turn's time, and never counts as a press whatever it says.
 */
const presses = (thread: StudyThread): number[] => {
  const answered = new Set(thread.study.turns.map((turn) => turn.at));
  const own = new Set(replies(thread).filter((message) => !answered.has(message.createdAt)));
  return thread.messages.flatMap((message, index) => (own.has(message) ? [index] : []));
};

/** Where a study stands: hints asked for so far, and whether the reader asked to be told. */
export const studyState = (thread: StudyThread): { hintsUsed: number; hintsLeft: number; told: boolean } => {
  const own = presses(thread).map((index) => thread.messages[index]);
  const hintsUsed = own.filter((message) => message.content.startsWith("Hint ")).length;
  return { hintsUsed, hintsLeft: Math.max(0, MAX_HINTS - hintsUsed), told: own.some((message) => isJustTellMe(message.content)) };
};

/** The tutor's reply to each "Hint n" the reader sent, oldest first. A hint still being written is not in it. */
export const hintsGiven = (thread: StudyThread): string[] =>
  presses(thread).flatMap((index) => {
    const next = thread.messages[index + 1];
    return thread.messages[index].content.startsWith("Hint ") && next?.role === "assistant" ? [next.content] : [];
  });

/** What the tutor said after "Just tell me", or null while it hasn't. */
export const toldAnswer = (thread: StudyThread): ChatMessage | null => {
  const asked = presses(thread).find((index) => isJustTellMe(thread.messages[index].content));
  const next = asked === undefined ? undefined : thread.messages[asked + 1];
  return next?.role === "assistant" ? next : null;
};

/** How a turn stands once the reader's own call is counted: theirs when they made one, "unsure" when the grader wasn't sure. */
export const standing = (turn: LearnerTurn): Verdict | "unsure" => turn.override ?? (turn.unsure ? "unsure" : turn.verdict);

const STANDING_WORDS: Record<Verdict | "unsure", string> = { right: "right", partly: "partly right", wrong: "not right", unsure: "unsure" };

/** The grade as a line in the thread, for the reader's transcript and for the tutor, who did not write it. */
export const gradeNote = (turn: LearnerTurn): string => {
  const words = turn.unsure ? "unsure" : STANDING_WORDS[turn.verdict];
  return turn.gap ? `Graded: ${words}. ${turn.gap.note}\n\n> ${turn.gap.span}` : `Graded: ${words}.`;
};

const squash = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** Below this many characters, one passage holding another says nothing: a single word sits in most paragraphs. */
const MIN_OVERLAP = 24;

/**
 * Whether the reader has already asked the tutor about this passage: an earlier thread on the same text, on text
 * that holds the selection, or on text the selection holds. Parked questions were never asked, so they don't count.
 */
export const seenBefore = (threads: readonly Thread[], quote: string): boolean => {
  const wanted = squash(quote);
  return threads.some((thread) => {
    if (thread.kind !== "passage" || thread.parkedAt || thread.action === "recap") return false;
    const theirs = squash(thread.quote);
    if (theirs === wanted) return true;
    const [shorter, longer] = theirs.length < wanted.length ? [theirs, wanted] : [wanted, theirs];
    return shorter.length >= MIN_OVERLAP && longer.includes(shorter);
  });
};

/** A study on exactly this passage that the reader has not answered or been told, to pick up instead of starting another. */
export const openStudy = (threads: readonly Thread[], quote: string): StudyThread | null =>
  threads.filter(isStudy).findLast((thread) => squash(thread.quote) === squash(quote) && !thread.study.turns.length && !studyState(thread).told) ?? null;

const YOUR_TURN = /(?:^|\n)[ \t]*(?:\*\*)?Your turn:(?:\*\*)?[ \t]*(\S[^\n]*?)[ \t]*$/i;

/** An answer's closing "Your turn: …" line, split from the answer. `prompt` is null when there is none. */
export const splitYourTurn = (text: string): { body: string; prompt: string | null } => {
  const trimmed = text.trimEnd();
  const match = YOUR_TURN.exec(trimmed);
  /* A line set wholly in bold leaves its closing marks on the question. */
  const prompt = match?.[1].replace(/\*+$/, "").trim();
  return match && prompt ? { body: trimmed.slice(0, match.index).trimEnd(), prompt } : { body: text, prompt: null };
};

/** Passage threads whose answer may close with a "Your turn" line: an asked question, or Ask with nothing typed. */
export const offersYourTurn = (thread: Thread): thread is PassageThread => thread.kind === "passage" && !thread.study && (thread.action === "ask" || thread.action === "explain");

/** After this many "Your turn" prompts are passed over in a session, no more are shown in it. */
export const YOUR_TURN_SKIPS = 2;

/** Where `span` sits in `passage`, allowing for different spacing, as [start, end); null when it isn't there as written. */
export const locateSpan = (passage: string, span: string): [number, number] | null => {
  const words = span.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const pattern = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const match = new RegExp(pattern, "i").exec(passage);
  return match ? [match.index, match.index + match[0].length] : null;
};
