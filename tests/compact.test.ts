import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readBookState } from "@/lib/server/store";
import { openTurn } from "@/lib/server/turns";
import { COMPACT_AT, foldPoint, sentTokens, summaryRequest, writeSummary } from "@/lib/server/tutor/compact";
import { buildTurn } from "@/lib/server/tutor/prompt";
import type { Provider, TutorEvent, TutorTurn } from "@/lib/server/tutor/types";
import type { BookId, ChatMessage, Thread, TurnUsage } from "@/lib/shared/types";
import { threadUsage } from "@/lib/shared/usage";

const book = { title: "A Book", author: null };
const noImages = new Map<string, Buffer>();

/** A passage thread of `exchanges` question-and-answer pairs after the first question, each about `size` characters. */
const longThread = (exchanges: number, size = 4000): Thread => {
  const messages: ChatMessage[] = [{ role: "user", content: "Explain this passage.", createdAt: "" }];
  for (let i = 0; i < exchanges; i++) {
    messages.push({ role: "assistant", content: `Answer ${i}. ${"a".repeat(size)}`, createdAt: "" });
    messages.push({ role: "user", content: `Question ${i + 1}?`, createdAt: "" });
  }
  messages.push({ role: "assistant", content: "Last answer.", createdAt: "" });
  messages.push({ role: "user", content: "One more question?", createdAt: "" });
  return {
    kind: "passage",
    id: "t1",
    anchor: { kind: "epub", cfi: "epubcfi(/6/4!/4/2/1:0)" },
    quote: "The interval grows after every successful recall.",
    before: "",
    after: "",
    chapterTitle: "Chapter One",
    action: "explain",
    provider: "api",
    sessionId: null,
    createdAt: "",
    messages,
  };
};

const roles = (turn: TutorTurn) => turn.messages.map((message) => message.role);
const alternates = (turn: TutorTurn) => roles(turn).every((role, i) => role === (i % 2 === 0 ? "user" : "assistant"));

/** A tutor that answers every request with `answer`, after reporting usage. */
const fakeProvider = (answer: string | null, seen: TutorTurn[] = []): Provider => ({
  id: "api",
  label: "Fake",
  probe: async () => ({ status: "ready", detail: null, version: null }),
  async *run(turn): AsyncGenerator<TutorEvent> {
    seen.push(turn);
    const usage: TurnUsage = {
      provider: "api",
      model: "m",
      scope: "turn",
      sessionId: null,
      costScope: "turn",
      inputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 20,
      contextTokens: 120,
      contextWindow: 1_000_000,
      costUsd: 0.5,
      costBasis: "api",
    };
    yield { type: "usage", usage };
    if (answer === null) yield { type: "error", message: "Overloaded" };
    else yield { type: "text", delta: answer };
  },
});

describe("when to compact", () => {
  it("counts everything sent, but only the newest message for a resumed CLI session", () => {
    const turn = buildTurn(book, longThread(200), null, noImages);
    expect(sentTokens(turn)).toBeGreaterThan(COMPACT_AT);
    expect(sentTokens({ ...turn, sessionId: "s1" })).toBeLessThan(100);
  });

  it("folds up to the reader's message that starts the newest few, and only past the last summary", () => {
    const thread = longThread(200);
    const keepFrom = foldPoint(thread);
    /* Six from the end lands on an answer, so it steps back one to the reader's message before it. */
    expect(keepFrom).toBe(thread.messages.length - 7);
    expect(thread.messages[keepFrom ?? 0].role).toBe("user");
    expect(foldPoint({ ...thread, compaction: { summary: "s", keepFrom: keepFrom ?? 0, createdAt: "", usage: [] } })).toBeNull();
    expect(foldPoint(longThread(1))).toBeNull();
  });
});

describe("a compacted thread", () => {
  it("still answers at 200 turns: the passage, the summary, then only the newest messages, roles alternating", () => {
    const thread = longThread(200);
    const keepFrom = foldPoint(thread) ?? 0;
    const compacted = { ...thread, compaction: { summary: "They are working out why the interval grows.", keepFrom, createdAt: "", usage: [] } };
    const turn = buildTurn(book, compacted, null, noImages);
    /* The first kept message is the reader's, so it joins the opening one. */
    expect(turn.messages).toHaveLength(thread.messages.length - keepFrom);
    expect(turn.messages[0].content).toContain(thread.messages[keepFrom].content);
    expect(turn.messages[0].content).toContain("<selection>\nThe interval grows after every successful recall.\n</selection>");
    expect(turn.messages[0].content).toContain("They are working out why the interval grows.");
    expect(turn.messages.at(-1)?.content).toBe("One more question?");
    expect(alternates(turn)).toBe(true);
    expect(sentTokens(turn)).toBeLessThan(COMPACT_AT / 10);
  });

  it("asks for a summary of only the turns since the last one, carrying the last one over", () => {
    const thread = longThread(10, 10);
    const first = summaryRequest(book, thread, 7);
    expect(first).toContain("Answer 0.");
    expect(first).toContain("Question 3?");
    expect(first).not.toContain("Answer 3.");
    const again = summaryRequest(book, { ...thread, compaction: { summary: "Earlier notes.", keepFrom: 7, createdAt: "", usage: [] } }, 13);
    expect(again).toContain("Earlier notes.");
    expect(again).not.toContain("Answer 2.");
    expect(again).toContain("Answer 3.");
  });
});

describe("writing and saving a summary", () => {
  it("saves the summary beside the thread's messages, which stay as they were, and counts its cost", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-compact-"));
    const bookId = "d".repeat(40) as BookId;
    const thread = longThread(200);
    const turn = await openTurn(bookId, { kind: "new", thread }, "api", dir);
    if (typeof turn === "string") throw new Error(turn);

    const seen: TutorTurn[] = [];
    const keepFrom = foldPoint(turn.thread) ?? 0;
    const written = await writeSummary(fakeProvider("Notes on the thread.", seen), book, turn.thread, keepFrom, "m", new AbortController().signal);
    expect(seen[0].sessionId).toBeNull();
    expect(written?.summary).toBe("Notes on the thread.");

    const compacted = await turn.compact({ summary: written?.summary ?? "", keepFrom, createdAt: "now", usage: written?.usage ? [written.usage] : [] });
    expect(buildTurn(book, compacted, null, noImages).messages[0].content).toContain("Notes on the thread.");
    await turn.close({ text: "An answer.", sessionId: null, partial: false });

    const stored = (await readBookState(bookId, dir)).threads[0];
    expect(stored.messages).toHaveLength(thread.messages.length + 1);
    expect(stored.messages.slice(0, -1)).toEqual(thread.messages);
    expect(stored.compaction?.summary).toBe("Notes on the thread.");
    expect(threadUsage(stored).costUsd).toBe(0.5);
  });

  it("gives up without a summary when the tutor fails, so the turn goes ahead as it was", async () => {
    const thread = longThread(200);
    expect(await writeSummary(fakeProvider(null), book, thread, foldPoint(thread) ?? 0, null, new AbortController().signal)).toBeNull();
    expect(await writeSummary(fakeProvider("   "), book, thread, foldPoint(thread) ?? 0, null, new AbortController().signal)).toBeNull();
  });
});

describe("a message about the whiteboard", () => {
  const board = (text: string) => ({ id: "board-0001", title: "Habits", scene: { nodes: [{ id: "n1", text, x: 0, y: 0 }], links: [], loose: 0, sketches: 0 }, ids: { n1: "el-1" } });

  it("sends the newest board as JSON with how to change it, and only names an earlier one", () => {
    const thread = longThread(1, 10);
    thread.messages[2] = { ...thread.messages[2], board: board("Old cue") };
    thread.messages[4] = { ...thread.messages[4], board: board("New cue") };
    const sent = buildTurn(book, thread, null, noImages).messages.map((message) => message.content).join("\n");
    expect(sent).toContain('"text":"New cue"');
    expect(sent).not.toContain("Old cue");
    expect(sent).toContain("as it was then");
    expect(sent).toContain("```board fence");
    expect(sent).toContain('"op": "add_node"');
  });

  it("carries the newest board through a summary that folds the message it came with, and never sends an older one as current", () => {
    const thread = longThread(3, 10);
    thread.messages[0] = { ...thread.messages[0], board: board("Old cue") };
    thread.messages[4] = { ...thread.messages[4], board: board("New cue") };
    const compacted = { ...thread, compaction: { summary: "Notes.", keepFrom: 6, createdAt: "", usage: [] } };
    const turn = buildTurn(book, compacted, null, noImages);
    const opening = turn.messages[0].content;
    expect(opening).toContain('"text":"New cue"');
    expect(opening).toContain("in the summarized turns");
    expect(opening.indexOf("New cue")).toBeGreaterThan(opening.indexOf("<summary>"));
    const sent = turn.messages.map((message) => message.content).join("\n");
    expect(sent).not.toContain("Old cue");
    expect(sent).toContain("as it was then");
    /* Its changes could only land on an answer to a message that carries it, so none are asked for. */
    expect(sent).not.toContain("```board fence");
    expect(alternates(turn)).toBe(true);

    /* While the newest board's message is still sent, it goes whole there, as before. */
    const kept = buildTurn(book, { ...compacted, compaction: { ...compacted.compaction, keepFrom: 4 } }, null, noImages);
    const keptText = kept.messages.map((message) => message.content).join("\n");
    expect(keptText).toContain("```board fence");
    expect(keptText).not.toContain("in the summarized turns");
    expect(keptText).not.toContain("Old cue");
  });
});
