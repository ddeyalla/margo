import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readBookState } from "@/lib/server/store";
import { openTurn, parseTurnRequest, type TurnRequest } from "@/lib/server/turns";
import { buildTurn, TUTOR_SYSTEM } from "@/lib/server/tutor/prompt";
import { summaryRequest } from "@/lib/server/tutor/compact";
import { answerCitations, citationNote, citedNumber, firstQuoteNumber, samePassage, threadQuotes } from "@/lib/shared/quotes";
import type { BookId, ChatMessage, GeneralThread, LibraryBook, QuotedPassage } from "@/lib/shared/types";

const bookId = "c".repeat(40) as BookId;
const book: LibraryBook = {
  id: bookId,
  format: "epub",
  relPath: "memory.epub",
  folder: "",
  fileTitle: "Memory",
  fileAuthor: null,
  sizeBytes: 1,
  modifiedAt: "2026-11-24T00:00:00.000Z",
};
const label = { title: "Memory", author: "A. Writer" };
const noImages = new Map<string, Buffer>();

const passage = (n: number): QuotedPassage => ({
  anchor: { kind: "epub", cfi: `epubcfi(/6/${2 * n}!/4/2/1:0)` },
  text: `Passage number ${n}.`,
  chapterTitle: `Chapter ${n}`,
});

const user = (content: string, quotes?: QuotedPassage[]): ChatMessage => ({ role: "user", content, createdAt: "", ...(quotes ? { quotes } : {}) });
const tutor = (content: string): ChatMessage => ({ role: "assistant", content, createdAt: "" });

const thread = (messages: ChatMessage[]): GeneralThread => ({
  kind: "general",
  id: "g1",
  anchor: null,
  chapterTitle: null,
  provider: "claude",
  sessionId: null,
  createdAt: "",
  messages,
});

const reply = (parsed: TurnRequest | string) => {
  if (typeof parsed === "string" || parsed.kind !== "reply") throw new Error(String(parsed));
  return parsed.message;
};

describe("quoting passages into a message", () => {
  it("keeps each quoted passage with its anchor, and asks about them when there are no words", async () => {
    const message = reply(await parseTurnRequest({ kind: "reply", threadId: "t", text: "", quotes: [passage(1), passage(2)] }, book, "claude", tmpdir()));
    expect(message.content).toBe("Explain these passages.");
    expect(message.quotes).toEqual([passage(1), passage(2)]);
  });

  it("refuses too many passages, an anchor from another format, and a quote with no text", async () => {
    const tooMany = [1, 2, 3, 4, 5, 6].map(passage);
    expect(await parseTurnRequest({ kind: "reply", threadId: "t", text: "Hi", quotes: tooMany }, book, "claude", tmpdir())).toMatch(/up to 5/);
    const pdf = { ...passage(1), anchor: { kind: "pdf", page: 1, start: 0, end: 4 } };
    expect(await parseTurnRequest({ kind: "reply", threadId: "t", text: "Hi", quotes: [pdf] }, book, "claude", tmpdir())).toMatch(/Quote up to/);
    expect(await parseTurnRequest({ kind: "reply", threadId: "t", text: "Hi", quotes: [{ ...passage(1), text: " " }] }, book, "claude", tmpdir())).toMatch(/Quote up to/);
  });

  it("saves the passages with the message, so citations still resolve when the thread is read again", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-citations-"));
    const turn = await openTurn(bookId, { kind: "new", thread: thread([user("What links these?", [passage(1)])]) }, "claude", dir);
    if (typeof turn === "string") throw new Error(turn);
    await turn.close({ text: "They [both rebuild memory](#cite-1).", sessionId: null, partial: false });
    const [saved] = (await readBookState(bookId, dir)).threads;
    expect(threadQuotes(saved.messages)).toEqual([passage(1)]);
    expect(answerCitations(saved.messages[1].content, threadQuotes(saved.messages).length)).toEqual([{ number: 1, claims: ["both rebuild memory"] }]);
  });
});

describe("what the tutor reads", () => {
  it("numbers passages across the whole thread and asks for links back to them", () => {
    const messages = [user("First", [passage(1)]), tutor("A"), user("Second", [passage(2), passage(3)])];
    const turn = buildTurn(label, thread(messages), null, noImages);
    expect(turn.messages[0].content).toContain('<passage n="1" where="Chapter 1">\nPassage number 1.\n</passage>');
    expect(turn.messages[2].content).toMatch(/^The passages I'm quoting:\n<passage n="2"[\s\S]*<passage n="3"[\s\S]*\n\nSecond$/);
    expect(TUTOR_SYSTEM).toContain("(#cite-2)");
    expect(firstQuoteNumber(messages, 2)).toBe(2);
  });

  it("keeps a passage's number, and its text, once the turns that quoted it are summarized", () => {
    const messages = [user("Start"), tutor("A"), user("Old", [passage(1)]), tutor("B"), user("New", [passage(2)])];
    const compacted = { ...thread(messages), compaction: { summary: "Notes.", keepFrom: 4, createdAt: "", usage: [] } };
    const turn = buildTurn(label, compacted, null, noImages);
    expect(turn.messages[0].content).toContain('Passages quoted in the summarized turns:\nThe passage I\'m quoting:\n<passage n="1"');
    expect(turn.messages.at(-1)?.content).toContain('<passage n="2"');
    expect(summaryRequest(label, thread(messages), 4)).toContain('<passage n="1" where="Chapter 1">');
  });
});

describe("citations in an answer", () => {
  it("reads only #cite- links, and only for passages the thread has", () => {
    expect(citedNumber("#cite-3")).toBe(3);
    expect(citedNumber("https://example.com/#cite-3")).toBeNull();
    const text = [
      "Memory is [rebuilt each time](#cite-1), and [rebuilt each time](#cite-1) again.",
      "It [fades too](#cite-1) and [goes beyond](#cite-9), see [a site](https://example.com).",
      "```md\n[in code](#cite-2)\n```",
      "Inline `[also code](#cite-2)` and [the second](#cite-2).",
    ].join("\n\n");
    expect(answerCitations(text, 2)).toEqual([
      { number: 1, claims: ["rebuilt each time", "fades too"] },
      { number: 2, claims: ["the second"] },
    ]);
  });

  it("saves a citation as a note that quotes what the tutor said rests on the passage", () => {
    expect(citationNote(["rebuilt each\ntime", "fades too"])).toBe("The tutor, citing this passage:\n\n> rebuilt each time\n>\n> fades too");
  });
});

describe("finding a quoted passage again", () => {
  it("matches the passage despite spacing, hyphenation and quote marks", () => {
    const quoted = "Memory isn't a record; it is re-built every time.";
    expect(samePassage("Memory isn’t a record;\n it is re-\nbuilt every  time.", quoted)).toBe(true);
    expect(samePassage("memory isn't a record; it is re-built every time", quoted)).toBe(true);
  });

  it("says no when the anchor lands on other text", () => {
    expect(samePassage("The weather in chapter two was cold.", "Memory isn't a record.")).toBe(false);
    expect(samePassage("Memory", "Memory isn't a record; it is rebuilt every time.")).toBe(false);
    expect(samePassage("", "Memory")).toBe(false);
  });
});
