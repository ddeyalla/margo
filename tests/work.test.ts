import { describe, expect, it } from "vitest";
import { ACTION_MESSAGES, buildTurn } from "@/lib/server/tutor/prompt";
import type { ChatMessage, PassageThread, Thread } from "@/lib/shared/types";
import { isSixthReply, workState } from "@/lib/shared/work";

const user = (content: string): ChatMessage => ({ role: "user", content, createdAt: "" });
const tutor = (): ChatMessage => ({ role: "assistant", content: "A question?", createdAt: "" });

/** A work thread whose reader sent these replies, each answered, ending on the reader's last reply. */
const thread = (...replies: string[]): PassageThread => ({
  kind: "passage",
  id: "t1",
  anchor: { kind: "pdf", page: 3, start: 0, end: 0 },
  quote: "The selected words.",
  before: "",
  after: "",
  chapterTitle: null,
  action: "work",
  provider: "claude",
  sessionId: null,
  createdAt: "",
  messages: [user(ACTION_MESSAGES.work), ...replies.flatMap((reply) => [tutor(), user(reply)])],
});

const book = { title: "A Book", author: null };
const lastContent = (t: Thread) => buildTurn(book, t, null, new Map()).messages.at(-1)?.content ?? "";
const NOTE = "(This is my sixth reply. Explain it fully now.)";

describe("work request", () => {
  it("holds the rules for the whole thread", () => {
    const first = buildTurn(book, thread(), null, new Map()).messages[0].content;
    expect(first).toContain("decide the right answer privately");
    expect(first).toContain("never state it");
    expect(first).toContain("We're working out why X holds.");
    expect(first).toContain("right, partly right or wrong");
    expect(first).toContain("exactly one question: one sentence with one question mark");
    expect(first).toContain("joined with \"and\" or \"or\" counts as two");
    expect(first).toContain("Put any context before it as statements");
    expect(first).toContain("quote the words of mine that go wrong and say what to look at again");
    expect(first).toContain("never write the corrected version");
    expect(first).toContain("\"it doesn't say X, it says Y\"");
    expect(first).toContain("\"Hint 1\" to \"Hint 4\"");
    expect(first).toContain("name only where to look again, the sentence or paragraph, by its first few words");
    expect(first).toContain("Don't quote the part that holds the answer");
    expect(first).toContain("must not name or hint at the idea");
    expect(first).toContain("show the worked step");
    expect(first).toContain("\"Just tell me\"");
    expect(first).toContain("sixth reply");
    expect(first).toContain("normal tutor");
  });
});

describe("sixth reply", () => {
  it("adds the note to the provider's copy of the 6th reply only", () => {
    const sixth = thread("a", "b", "c", "d", "e", "f");
    expect(lastContent(sixth)).toBe(`f\n\n${NOTE}`);
    expect(sixth.messages.at(-1)?.content).toBe("f");
    expect(lastContent(thread("a", "b", "c", "d", "e"))).toBe("e");
  });

  it("leaves a later reply and the earlier replies alone", () => {
    const seventh = thread("a", "b", "c", "d", "e", "f", "g");
    expect(lastContent(seventh)).toBe("g");
    const turn = buildTurn(book, seventh, null, new Map()).messages;
    expect(turn.filter((message) => message.content.includes(NOTE))).toEqual([]);
  });

  it("never adds it after Just tell me, or to other actions", () => {
    expect(lastContent(thread("a", "Just tell me.", "c", "d", "e", "f"))).toBe("f");
    expect(isSixthReply({ ...thread("a", "b", "c", "d", "e", "f"), action: "deeper" })).toBe(false);
  });
});

describe("workState", () => {
  it("counts hints", () => {
    expect(workState(thread())).toEqual({ leading: true, hintsUsed: 0 });
    expect(workState(thread("my idea", "Hint 1", "Hint 2"))).toEqual({ leading: true, hintsUsed: 2 });
  });

  it("stops leading on Just tell me or at the sixth reply", () => {
    expect(workState(thread("a", "Just tell me.")).leading).toBe(false);
    expect(workState(thread("a", "b", "c", "d", "e")).leading).toBe(true);
    expect(workState(thread("a", "b", "c", "d", "e", "f")).leading).toBe(false);
  });

  it("is never leading outside a work thread", () => {
    expect(workState({ ...thread("a"), action: "explain" })).toEqual({ leading: false, hintsUsed: 0 });
  });
});
