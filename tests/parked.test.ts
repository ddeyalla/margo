import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discardParked, parkThread, saveParked } from "@/lib/server/parked";
import { readBookState } from "@/lib/server/store";
import { passageThread } from "@/lib/server/passage";
import { openTurn } from "@/lib/server/turns";
import { isParked, parkedFirst } from "@/lib/shared/parked";
import type { BookId, LibraryBook, PassageThread, Thread } from "@/lib/shared/types";

const bookId = "c".repeat(40) as BookId;
const book: LibraryBook = { id: bookId, format: "epub", relPath: "Test.epub", folder: "", fileTitle: "Test", fileAuthor: null, sizeBytes: 1, modifiedAt: "" };

const body = (question: unknown = "Why does this follow?") => ({
  question,
  provider: "codex",
  selection: { text: "An invented sentence.", before: "Earlier.", after: "Later.", anchor: { kind: "epub", cfi: "epubcfi(/6/4!/4/2/1:0)" }, chapterTitle: "Chapter One" },
});

const parked = (): PassageThread => {
  const thread = parkThread(body(), book);
  if (typeof thread === "string") throw new Error(thread);
  return thread;
};

describe("parking a question", () => {
  it("makes a passage thread of the Ask kind holding only the unsent question", () => {
    const thread = parked();
    expect(thread).toMatchObject({ kind: "passage", action: "ask", quote: "An invented sentence.", chapterTitle: "Chapter One", provider: "codex", sessionId: null });
    expect(thread.messages).toEqual([{ role: "user", content: "Why does this follow?", createdAt: thread.createdAt }]);
    expect(thread.parkedAt).toBe(thread.createdAt);
    expect(isParked(thread)).toBe(true);
  });

  it("needs a question and a valid passage", () => {
    expect(parkThread(body("   "), book)).toBe("A question is required.");
    expect(parkThread({ ...body(), selection: { text: "x", anchor: { kind: "pdf", page: 1, start: 0, end: 1 } } }, book)).toBe("Invalid selection.");
  });

  it("defaults the provider when none is chosen", () => {
    const thread = parkThread({ ...body(), provider: null }, book);
    expect(typeof thread === "string" ? thread : thread.provider).toBe("claude");
  });

  it("is saved with the book, and deleting removes it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "margo-parked-"));
    const thread = parked();
    await saveParked(bookId, thread, dir);
    expect((await readBookState(bookId, dir)).threads.map((t) => t.id)).toEqual([thread.id]);
    expect(await discardParked(bookId, thread.id, dir)).toEqual([]);
  });

  it("refuses to delete a thread that was already sent", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "margo-parked-"));
    const thread = parked();
    await saveParked(bookId, thread, dir);
    const turn = await openTurn(bookId, { kind: "retry", threadId: thread.id }, "claude", dir);
    expect(typeof turn).not.toBe("string");
    expect((await discardParked(bookId, thread.id, dir)).map((t) => t.id)).toEqual([thread.id]);
  });

  it("clears the parked mark when the question is sent, and uses the provider in use now", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "margo-parked-"));
    const thread = parked();
    await saveParked(bookId, thread, dir);
    const turn = await openTurn(bookId, { kind: "retry", threadId: thread.id }, "claude", dir);
    if (typeof turn === "string") throw new Error(turn);
    expect(isParked(turn.thread)).toBe(false);
    expect(turn.thread.provider).toBe("claude");
    await turn.close({ text: "An answer.", sessionId: null, partial: false });
    const [saved] = (await readBookState(bookId, dir)).threads;
    expect(isParked(saved)).toBe(false);
    expect(saved.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});

describe("parked questions in saved state", () => {
  it("loads state saved before parking existed, with and without the new fields", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "margo-parked-"));
    const old = { ...parked(), id: "old" } as Record<string, unknown>;
    delete old.parkedAt;
    delete old.kind;
    await writeFile(path.join(dir, `${bookId}.json`), JSON.stringify({ position: null, threads: [old, parked()] }));
    const state = await readBookState(bookId, dir);
    expect(state.lastReadAt).toBeNull();
    expect(state.threads.map((t) => [t.id === "old", isParked(t)])).toEqual([[true, false], [false, true]]);
  });

  it("lists parked questions newest first and leaves out threads that were sent", () => {
    const at = (parkedAt: string, id: string): Thread => ({ ...parked(), id, parkedAt });
    const sent: Thread = { ...parked(), id: "sent", parkedAt: null };
    expect(parkedFirst([at("2026-11-01T00:00:00Z", "a"), sent, at("2026-11-02T00:00:00Z", "b")]).map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("a recap request", () => {
  it("keeps what came before and drops what comes after", () => {
    const thread = passageThread({ ...body(), action: "recap", question: null, selection: { ...body().selection, before: "Before. ".repeat(100), after: "Spoiler." } }, book, "claude");
    if (typeof thread === "string" || thread.kind !== "passage") throw new Error("expected a passage thread");
    expect(thread.action).toBe("recap");
    expect(thread.after).toBe("");
    expect(thread.before.length).toBeGreaterThan(500);
    expect(thread.messages[0].content).toBe("Recap what came before this point.");
  });
});
