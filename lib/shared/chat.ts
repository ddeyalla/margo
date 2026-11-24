import type { Anchor, BookId, ProviderId, QuotedPassage, SelectionContext, TutorAction } from "./types";

/** Where the reader is, sent with a question that has no passage. */
export interface QuestionPlace {
  anchor: Anchor;
  chapterTitle: string | null;
}

/**
 * POST /api/chat: start a thread from a selection or with no passage, reply in
 * one, or get an answer to its unanswered message. `attachments` are ids of
 * images already uploaded for this book, and `quotes` passages of it the reader
 * quoted; a message may be images or quotes alone.
 */
export type ChatRequest =
  | {
      kind: "new";
      bookId: BookId;
      provider: ProviderId;
      action: TutorAction;
      /** The reader's question, for the "ask" action. */
      question: string | null;
      selection: Omit<SelectionContext, "rect">;
    }
  | { kind: "general"; bookId: BookId; provider: ProviderId; text: string; attachments: string[]; quotes: QuotedPassage[]; place: QuestionPlace | null }
  | { kind: "reply"; bookId: BookId; provider: ProviderId; threadId: string; text: string; attachments: string[]; quotes: QuotedPassage[] }
  | { kind: "retry"; bookId: BookId; provider: ProviderId; threadId: string };
