import type { BookId, ProviderId, SelectionContext, TutorAction } from "./types";

/** POST /api/chat: start a thread from a selection, or reply in one. */
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
  | { kind: "reply"; bookId: BookId; provider: ProviderId; threadId: string; text: string };
