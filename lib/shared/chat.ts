import type { BookId, ProviderId, SelectionContext, TutorAction } from "./types";

/** POST /api/chat: start a thread from a selection, reply in one, or get an answer to its unanswered message. */
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
  | { kind: "reply"; bookId: BookId; provider: ProviderId; threadId: string; text: string }
  | { kind: "retry"; bookId: BookId; provider: ProviderId; threadId: string };
