import { randomUUID } from "node:crypto";
import { trimAfter, trimBefore } from "@/lib/shared/context";
import type { LibraryBook, ProviderId, Thread, TutorAction, TypedAction } from "@/lib/shared/types";
import { ACTION_MESSAGES } from "./tutor/prompt";
import { isObject, MAX_MESSAGE, MAX_QUOTE, parseAnchor, shortText } from "./validate";

/** A recap reads more of what came before the reader's place than a question about a passage does. */
const RECAP_BEFORE = 6_000;
const ACTIONS: TutorAction[] = ["explain", "deeper", "work", "ask", "explainBack", "recap"];

/** A new thread about a passage, built from a validated request body with the reader's first message. Nothing is saved. */
export const passageThread = (body: Record<string, unknown>, book: LibraryBook, provider: ProviderId): Thread | string => {
  const now = new Date().toISOString();
  const action = ACTIONS.find((a) => a === body.action);
  const selection = isObject(body.selection) ? body.selection : null;
  const anchor = selection && parseAnchor(selection.anchor, book.format);
  const quote = selection && shortText(selection.text, MAX_QUOTE);
  if (!action || !selection || !anchor || !quote) return "Invalid selection.";
  const typed = action === "ask" || action === "explainBack";
  const question = typed ? shortText(body.question, MAX_MESSAGE) : null;
  if (typed && !question) return action === "ask" ? "A question is required." : "An explanation is required.";
  return {
    kind: "passage",
    id: randomUUID(),
    anchor,
    quote,
    before: trimBefore(typeof selection.before === "string" ? selection.before : "", action === "recap" ? RECAP_BEFORE : undefined),
    /* A recap is told only what came before the reader's place, never what follows. */
    after: action === "recap" ? "" : trimAfter(typeof selection.after === "string" ? selection.after : ""),
    chapterTitle: shortText(selection.chapterTitle, 500),
    action,
    provider,
    sessionId: null,
    createdAt: now,
    messages: [{ role: "user", content: question ?? ACTION_MESSAGES[action as Exclude<TutorAction, TypedAction>], createdAt: now }],
  };
};
