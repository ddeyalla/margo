import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readBookState } from "@/lib/server/store";
import { openTurn, type OpenTurn } from "@/lib/server/turns";
import type { BookId, Thread } from "@/lib/shared/types";

const bookId = "b".repeat(40) as BookId;

const newThread = (): Thread => ({
  id: "t1",
  anchor: { kind: "epub", cfi: "epubcfi(/6/4!/4/2/1:0)" },
  quote: "A passage.",
  before: "",
  after: "",
  chapterTitle: null,
  action: "explain",
  provider: "claude",
  sessionId: null,
  createdAt: "2026-11-13T00:00:00.000Z",
  messages: [{ role: "user", content: "Explain this passage.", createdAt: "2026-11-13T00:00:00.000Z" }],
});

const opened = (turn: OpenTurn | string): OpenTurn => {
  if (typeof turn === "string") throw new Error(turn);
  return turn;
};

const storedMessages = async (dir: string) =>
  (await readBookState(bookId, dir)).threads[0].messages.map((m) => [m.role, m.content, m.partial === true]);

describe("tutor turns", () => {
  it("keeps the reader's message when the tutor is stopped before its first word", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-turns-"));
    const turn = opened(await openTurn(bookId, { kind: "new", thread: newThread() }, "claude", dir));
    expect(await storedMessages(dir)).toEqual([["user", "Explain this passage.", false]]);
    await turn.close({ text: "", sessionId: null, partial: true });
    expect(await storedMessages(dir)).toEqual([["user", "Explain this passage.", false]]);
  });

  it("saves a follow-up sent right after Stop after the stopped answer", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-turns-"));
    const first = opened(await openTurn(bookId, { kind: "new", thread: newThread() }, "claude", dir));
    let followUpOpened = false;
    const followUp = openTurn(bookId, { kind: "reply", threadId: "t1", text: "Why?" }, "claude", dir).then((turn) => {
      followUpOpened = true;
      return opened(turn);
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(followUpOpened).toBe(false);

    await first.close({ text: "It means", sessionId: "s1", partial: true });
    const second = await followUp;
    expect(second.thread.messages.map((m) => m.content)).toEqual(["Explain this passage.", "It means", "Why?"]);
    expect(second.thread.sessionId).toBe("s1");
    await second.close({ text: "Because.", sessionId: "s1", partial: false });

    expect(await storedMessages(dir)).toEqual([
      ["user", "Explain this passage.", false],
      ["assistant", "It means", true],
      ["user", "Why?", false],
      ["assistant", "Because.", false],
    ]);
  });

  it("retries only a thread whose last message is unanswered", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-turns-"));
    await opened(await openTurn(bookId, { kind: "new", thread: newThread() }, "claude", dir)).close({
      text: "",
      sessionId: null,
      partial: true,
    });
    const retry = opened(await openTurn(bookId, { kind: "retry", threadId: "t1" }, "codex", dir));
    expect(retry.thread.messages.map((m) => m.content)).toEqual(["Explain this passage."]);
    expect(retry.thread.provider).toBe("codex");
    await retry.close({ text: "An answer.", sessionId: "c1", partial: false });

    expect(await openTurn(bookId, { kind: "retry", threadId: "t1" }, "codex", dir)).toBe(
      "This thread has no unanswered message to retry.",
    );
    expect(await storedMessages(dir)).toEqual([
      ["user", "Explain this passage.", false],
      ["assistant", "An answer.", false],
    ]);
  });
});
