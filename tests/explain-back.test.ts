import { describe, expect, it } from "vitest";
import { buildTurn, contextMessage } from "@/lib/server/tutor/prompt";
import { threadLabel } from "@/lib/shared/threads";
import type { PassageThread } from "@/lib/shared/types";

const WORDS = "It grows because the cells divide.";

const thread = (action: PassageThread["action"], first: string): PassageThread => ({
  kind: "passage",
  id: "t1",
  anchor: { kind: "pdf", page: 3, start: 0, end: 0 },
  quote: "The selected words.",
  before: "",
  after: "",
  chapterTitle: null,
  action,
  provider: "claude",
  sessionId: null,
  createdAt: "",
  messages: [{ role: "user", content: first, createdAt: "" }],
});

const book = { title: "A Book", author: null };

describe("explain it back", () => {
  it("sends the reader's words and the rules after the passage", () => {
    const message = contextMessage(book, thread("explainBack", WORDS));
    expect(message).toContain(`My explanation, in my own words: ${WORDS}`);
    expect(message.indexOf("<selection>")).toBeLessThan(message.indexOf("My explanation"));
    expect(message).toContain("first mistake only");
    expect(message).toContain("Quote my words");
    expect(message).toContain("Don't rewrite my whole explanation");
    expect(message).toContain("no praise padding");
    expect(message).toContain("try again");
  });

  it("keeps the reader's text as the stored first message and labels the thread by its action", () => {
    const t = thread("explainBack", WORDS);
    expect(t.messages[0]?.content).toBe(WORDS);
    expect(threadLabel(t)).toBe("Explain it back");
    expect(threadLabel(thread("ask", "Why?"))).toBe("Why?");
  });

  it("leaves later messages as they are", () => {
    const t = thread("explainBack", WORDS);
    t.messages.push({ role: "assistant", content: "Close.", createdAt: "" }, { role: "user", content: "Second try.", createdAt: "" });
    expect(buildTurn(book, t, null, new Map()).messages.at(-1)?.content).toBe("Second try.");
  });
});
