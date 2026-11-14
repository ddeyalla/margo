import type { Thread, TutorAction } from "./types";

export const ACTION_LABELS: Record<Exclude<TutorAction, "ask">, string> = {
  explain: "Explain",
  deeper: "Go deeper",
  work: "Work it out",
  explainBack: "Explain it back",
};

/** How a thread is named in the list: an asked question is its own words; the others are their action. */
export const threadLabel = (thread: Thread): string =>
  thread.kind === "general" ? "No passage" : thread.action === "ask" ? (thread.messages[0]?.content ?? "") : ACTION_LABELS[thread.action];
