import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { saveAttachment } from "@/lib/server/attachments";
import { readBookState } from "@/lib/server/store";
import { openTurn, parseTurnRequest, type OpenTurn, type TurnRequest } from "@/lib/server/turns";
import type { BookId, ImageAttachment, LibraryBook, Thread } from "@/lib/shared/types";

const bookId = "b".repeat(40) as BookId;

const newThread = (): Thread => ({
  kind: "passage",
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
    const followUp = openTurn(bookId, { kind: "reply", threadId: "t1", message: { role: "user", content: "Why?", createdAt: "" } }, "claude", dir).then((turn) => {
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

describe("chat requests", () => {
  const book: LibraryBook = {
    id: bookId,
    format: "epub",
    relPath: "A Book.epub",
    folder: "",
    fileTitle: "A Book",
    fileAuthor: null,
    sizeBytes: 1,
    modifiedAt: "",
  };
  const png = readFileSync(path.join(__dirname, "fixtures", "images", "tiny.png"));

  const withImages = async (count: number) => {
    const dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-requests-"));
    const images: ImageAttachment[] = [];
    for (let n = 0; n < count; n++) {
      const saved = await saveAttachment(bookId, png, dir);
      if (typeof saved === "string") throw new Error(saved);
      images.push(saved);
    }
    return { dir, images, ids: images.map((image) => image.id) };
  };

  const reply = (request: TurnRequest | string) => {
    if (typeof request === "string" || request.kind !== "reply") throw new Error(String(request));
    return request.message;
  };

  it("attaches each stored image to the reply, with the type and size read from its file", async () => {
    const { dir, images, ids } = await withImages(2);
    const message = reply(await parseTurnRequest({ kind: "reply", threadId: "t1", text: " What is this? ", attachments: ids }, book, "claude", dir));
    expect(message).toMatchObject({ role: "user", content: "What is this?", attachments: images });
    expect(images[0]).toMatchObject({ mediaType: "image/png", width: 3, height: 2 });
  });

  it("asks the tutor to explain images sent with no words", async () => {
    const one = await withImages(1);
    expect(reply(await parseTurnRequest({ kind: "reply", threadId: "t1", text: "", attachments: one.ids }, book, "claude", one.dir)).content).toBe(
      "Explain this image.",
    );
    const two = await withImages(2);
    expect(reply(await parseTurnRequest({ kind: "reply", threadId: "t1", text: "  ", attachments: two.ids }, book, "claude", two.dir)).content).toBe(
      "Explain these images.",
    );
  });

  it("refuses an image this book doesn't have, a malformed id, duplicates and more than four", async () => {
    const { dir, ids } = await withImages(5);
    const send = (attachments: unknown) => parseTurnRequest({ kind: "reply", threadId: "t1", text: "Hi", attachments }, book, "claude", dir);
    expect(await send(["f".repeat(32)])).toBe("An attached image is missing. Remove it and attach it again.");
    expect(await parseTurnRequest({ kind: "reply", threadId: "t1", text: "Hi", attachments: ids.slice(0, 1) }, { ...book, id: "d".repeat(40) as BookId }, "claude", dir)).toBe(
      "An attached image is missing. Remove it and attach it again.",
    );
    expect(await send(["../settings.json"])).toBe("Attach up to 4 images to a message.");
    expect(await send([ids[0], ids[0]])).toBe("Attach up to 4 images to a message.");
    expect(await send(ids)).toBe("Attach up to 4 images to a message.");
    expect(await send("not a list")).toBe("Attach up to 4 images to a message.");
  });

  it("needs words or an image", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-requests-"));
    expect(await parseTurnRequest({ kind: "reply", threadId: "t1", text: "   " }, book, "claude", dir)).toBe("Write a message or attach an image.");
    expect(await parseTurnRequest({ kind: "reply", threadId: "t1", text: "x".repeat(8001) }, book, "claude", dir)).toBe("This message is too long.");
  });

  it("starts a thread with no passage at the reader's place, or nowhere before the book has reported one", async () => {
    const { dir, images, ids } = await withImages(1);
    const anchor = { kind: "epub", cfi: "epubcfi(/6/8!/4/2/1:0)" } as const;
    const placed = await parseTurnRequest(
      { kind: "general", text: "", attachments: ids, place: { anchor, chapterTitle: "Chapter 4" } },
      book,
      "claude",
      dir,
    );
    expect(placed).toMatchObject({
      kind: "new",
      thread: { kind: "general", anchor, chapterTitle: "Chapter 4", provider: "claude", sessionId: null, messages: [{ content: "Explain this image.", attachments: images }] },
    });
    const nowhere = await parseTurnRequest({ kind: "general", text: "What is a tensor?", attachments: [], place: null }, book, "claude", dir);
    expect(nowhere).toMatchObject({ kind: "new", thread: { kind: "general", anchor: null, chapterTitle: null } });
  });

  it("refuses a place from the wrong kind of book", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-requests-"));
    const place = { anchor: { kind: "pdf", page: 2, start: 0, end: 0 }, chapterTitle: null };
    expect(await parseTurnRequest({ kind: "general", text: "Hi", place }, book, "claude", dir)).toBe("Invalid place.");
  });

  it("builds a passage thread from a selection as before", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-requests-"));
    const selection = { text: "A passage.", before: "", after: "", anchor: { kind: "epub", cfi: "epubcfi(/6/4)" }, chapterTitle: null };
    expect(await parseTurnRequest({ kind: "new", action: "explain", question: null, selection }, book, "claude", dir)).toMatchObject({
      kind: "new",
      thread: { kind: "passage", quote: "A passage.", action: "explain", messages: [{ content: "Explain this passage." }] },
    });
  });
});
