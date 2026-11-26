import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readActivity } from "@/lib/server/activity";
import { readLibrary } from "@/lib/server/library";
import { serve } from "@/lib/server/mcp/server";
import { readBookState, updateBookState } from "@/lib/server/store";
import { decideSuggestion, listSuggestions, pendingSuggestions, SuggestionError } from "@/lib/server/suggestions";
import { callTool, TOOLS } from "@/lib/server/tools";
import { readToolLog, summarizeArgs } from "@/lib/server/tools/log";
import { jsonSchema, parseInput, ToolError } from "@/lib/server/tools/schema";
import { addCards } from "@/lib/shared/cards";
import { isParked } from "@/lib/shared/parked";
import { emptySuggestions, MAX_DECIDED, MAX_PENDING, withDecision, withProposed, type CardSuggestion } from "@/lib/shared/suggestions";
import type { Anchor, BookId } from "@/lib/shared/types";
import { makeEpub } from "./fixtures/books";

let dataDir: string;
let bookId: BookId;

/** Calls a tool as an agent would and returns what it answered, failing the test if it was refused. */
const call = async <T = Record<string, unknown>>(name: string, args?: unknown, caller = "test-agent"): Promise<T> => {
  const result = await callTool(name, args, caller);
  if (!result.ok) throw new Error(`${name} was refused: ${result.error}`);
  return result.value as T;
};

const refusal = async (name: string, args?: unknown): Promise<string> => {
  const result = await callTool(name, args, "test-agent");
  return result.ok ? "" : result.error;
};

interface Hit {
  bookId: BookId;
  chapter: string | null;
  anchor: Anchor;
  snippet: string;
}

const tidalHit = async (): Promise<Hit> => (await call<{ hits: Hit[] }>("search_library", { query: "tidal locking" })).hits[0];

beforeAll(async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rigg-learn-tools-"));
  const booksDir = path.join(root, "books");
  dataDir = path.join(root, "data");
  await mkdir(booksDir);
  await writeFile(
    path.join(booksDir, "Moons - Ada Field.epub"),
    makeEpub([
      { title: "Orbits", paragraphs: ["A moon in tidal locking shows its planet one face.", "The far side is never seen from the ground."] },
      { title: "Craters", paragraphs: ["Impacts leave craters that outlast any weather.", "Old surfaces are the most heavily marked."] },
    ]),
  );
  vi.stubEnv("BOOKS_DIR", booksDir);
  vi.stubEnv("DATA_DIR", dataDir);
  vi.stubEnv("NOTES_DIR", "");
  bookId = (await readLibrary()).books[0].id;
});

describe("tool inputs", () => {
  const fields = {
    name: { type: "string", max: 5, description: "A name." },
    kind: { type: "string", max: 10, oneOf: ["a", "b"], optional: true, description: "A kind." },
    count: { type: "integer", min: 1, max: 3, optional: true, description: "A count." },
  } as const;

  it("come back in the fields' shape, trimmed", () => {
    expect(parseInput(fields, { name: " ab ", count: 2 })).toEqual({ name: "ab", count: 2 });
    expect(parseInput({}, undefined)).toEqual({});
  });

  it("are refused with what was wrong", () => {
    expect(() => parseInput(fields, {})).toThrow('"name" is required.');
    expect(() => parseInput(fields, { name: "abcdef" })).toThrow("longer than 5");
    expect(() => parseInput(fields, { name: "ab", kind: "c" })).toThrow("one of: a, b");
    expect(() => parseInput(fields, { name: "ab", count: 2.5 })).toThrow("whole number from 1 to 3");
    expect(() => parseInput(fields, { name: "ab", nmae: "x" })).toThrow('Unknown argument "nmae"');
    expect(() => parseInput(fields, [])).toThrow(ToolError);
  });

  it("describe themselves as a JSON Schema", () => {
    expect(jsonSchema(fields)).toEqual({
      type: "object",
      properties: {
        name: { type: "string", description: "A name.", maxLength: 5 },
        kind: { type: "string", description: "A kind.", maxLength: 10, enum: ["a", "b"] },
        count: { type: "integer", description: "A count.", minimum: 1, maximum: 3 },
      },
      required: ["name"],
      additionalProperties: false,
    });
  });
});

describe("the registry", () => {
  it("names every tool once, and offers nothing that reaches the web or runs a model", () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((name) => /web|fetch|http|url|ask_tutor|chat/.test(name))).toEqual([]);
    expect(TOOLS.filter((tool) => tool.effect === "write").map((tool) => tool.name)).toEqual(["park_question", "log_activity"]);
  });
});

describe("read tools", () => {
  it("list the library", async () => {
    const { books } = await call<{ books: Record<string, unknown>[] }>("list_library");
    expect(books).toEqual([expect.objectContaining({ id: bookId, title: "Moons", author: "Ada Field", format: "epub", progress: null, cardsDue: 0 })]);
  });

  it("read a book's text by chapter and by place", async () => {
    const whole = await call<{ chapters: { title: string; firstBlock: number }[]; blocks: { index: number; text: string; anchor: Anchor }[]; next: number | null }>("get_book_text", { bookId });
    expect(whole.chapters.map((chapter) => chapter.title)).toEqual(["Orbits", "Craters"]);
    expect(whole.next).toBeNull();

    const craters = await call<typeof whole>("get_book_text", { bookId, chapter: "crater" });
    expect(craters.blocks.map((block) => block.text).join(" ")).toContain("Impacts leave craters");
    expect(craters.blocks.map((block) => block.text).join(" ")).not.toContain("tidal locking");
    expect(craters.blocks[0].anchor.kind).toBe("epub");

    const paged = await call<typeof whole>("get_book_text", { bookId, maxChars: 500, from: whole.blocks[1].index });
    expect(paged.blocks[0].index).toBe(whole.blocks[1].index);
    expect(await refusal("get_book_text", { bookId, chapter: "Volcanoes" })).toContain('No chapter is called "Volcanoes"');
  });

  it("search the library, waiting for a book that hasn't been read yet", async () => {
    const hit = await tidalHit();
    expect(hit).toMatchObject({ bookId, chapter: "Orbits" });
    expect(hit.snippet).toContain("tidal locking");
  });

  it("refuse a book that isn't there, in words an agent can act on", async () => {
    expect(await refusal("list_annotations", { bookId: "f".repeat(40) })).toContain("Call list_library");
    expect(await refusal("no_such_tool")).toContain('no tool called "no_such_tool"');
  });

  it("read highlights, notes, threads, the review queue, Today and Courses", async () => {
    const anchor: Anchor = { kind: "epub", cfi: "epubcfi(/6/4!/4/2/1:0)" };
    await updateBookState(bookId, (state) => ({
      ...state,
      highlights: [{ id: "h1", anchor, quote: "one face", chapterTitle: "Orbits", color: "amber", createdAt: new Date(0).toISOString() }],
      cardSets: addCards(state.cardSets, { anchor, quote: "one face", chapterTitle: "Orbits", fact: "A locked moon shows one face.", cards: [{ question: "What does a locked moon show?", answer: "One face." }] }, new Date(), () => "set-1").sets,
    }));
    expect((await call<{ highlights: unknown[] }>("list_annotations", { bookId })).highlights).toHaveLength(1);
    expect(await call("review_queue")).toMatchObject({ due: 1, cards: [{ bookId, fact: "A locked moon shows one face.", cards: [{ question: "What does a locked moon show?", answer: "One face." }] }] });
    expect(await call("get_today")).toMatchObject({ due: 1, dueBook: { id: bookId } });
    expect(await call("list_courses")).toEqual({ courses: [] });
    expect(await call("list_boards", { bookId })).toEqual({ boards: [] });
    expect(await refusal("read_board", { bookId, boardId: "12345678" })).toContain("no notes folder");
  });
});

describe("the two direct writes", () => {
  it("park a question on a passage, which the thread tools then show", async () => {
    const hit = await tidalHit();
    const { threadId } = await call<{ threadId: string }>("park_question", { bookId, question: "Why only one face?", selection: { text: "A moon in tidal locking shows its planet one face.", anchor: hit.anchor, chapterTitle: "Orbits" } });
    const saved = (await readBookState(bookId)).threads.find((thread) => thread.id === threadId)!;
    expect(isParked(saved)).toBe(true);
    expect(await call("list_threads", { bookId })).toMatchObject({ threads: [{ id: threadId, parked: true, question: "Why only one face?", chapter: "Orbits" }] });
    expect(await call("get_thread", { bookId, threadId })).toMatchObject({ parked: true, messages: [{ role: "user", content: "Why only one face?" }] });
    expect(await refusal("park_question", { bookId, question: "Why?", selection: { text: "x", anchor: { kind: "pdf", page: 1, start: 0, end: 1 } } })).toBe("Invalid selection.");
  });

  it("log learning time, capped like the app's own reports", async () => {
    expect(await call("log_activity", { bookId, kind: "review", seconds: 500 })).toEqual({ recorded: 120 });
    const days = Object.values((await readActivity()).days);
    expect(days).toEqual([{ [bookId]: { review: 120 } }]);
    expect(await refusal("log_activity", { bookId, kind: "napping", seconds: 5 })).toContain("one of: reading, review, quiz");
  });
});

describe("the tool log", () => {
  it("keeps every call: who, what, a short form of the arguments, and how it went", async () => {
    await callTool("list_library", {}, "log-check");
    await callTool("get_book_text", { bookId: "nope", chapter: "x".repeat(500) }, "log-check");
    const calls = (await readToolLog()).filter((entry) => entry.caller === "log-check");
    expect(calls).toMatchObject([
      { tool: "list_library", args: "{}", outcome: "ok" },
      { tool: "get_book_text", outcome: "refused", error: expect.stringContaining("Call list_library") },
    ]);
    expect(calls[1].args).toContain("(500 characters)");
    expect(calls[1].args.length).toBeLessThan(300);
    expect(Number.isNaN(Date.parse(calls[0].at))).toBe(false);
    /* One line per call, and nothing is ever rewritten. */
    const lines = (await readFile(path.join(dataDir, "tool-log.jsonl"), "utf8")).trimEnd().split("\n");
    expect(lines.length).toBe((await readToolLog()).length);
  });

  it("cuts long and deep arguments to a line", () => {
    expect(summarizeArgs(undefined)).toBe("{}");
    expect(summarizeArgs({ list: Array.from({ length: 50 }, (_, n) => n) })).toBe('{"list":[0,1,2,3,4]}');
    expect(summarizeArgs({ text: "y".repeat(100_000) }).length).toBeLessThan(200);
  });
});

describe("suggestions", () => {
  const proposal = (anchor: Anchor) => ({
    bookId,
    anchor,
    quote: "Impacts leave craters that outlast any weather.",
    chapterTitle: "Craters",
    fact: "Craters outlast weather.",
    cards: [
      { question: "What outlasts any weather on a moon?", answer: "Its craters." },
      { question: "Why do old surfaces show the most craters?", answer: "Nothing wears them away." },
    ],
  });
  const craterAnchor = async () => (await call<{ hits: Hit[] }>("search_library", { query: "impacts craters weather" })).hits[0].anchor;

  it("wait in the inbox, and change nothing until accepted", async () => {
    const before = (await readBookState(bookId)).cardSets.length;
    const { suggestionId } = await call<{ suggestionId: string }>("propose_card", proposal(await craterAnchor()), "night-agent");
    expect((await readBookState(bookId)).cardSets).toHaveLength(before);
    expect(await call("list_suggestions", { status: "pending" })).toMatchObject({ suggestions: [{ id: suggestionId, kind: "card", proposer: "night-agent", status: "pending", target: { bookId } }] });
    expect(await pendingSuggestions()).toMatchObject([{ id: suggestionId, bookTitle: "Moons" }]);

    const accepted = await decideSuggestion(suggestionId, "accept");
    expect(accepted).toMatchObject({ status: "accepted" });
    const sets = (await readBookState(bookId)).cardSets;
    expect(sets).toHaveLength(before + 1);
    expect(sets.at(-1)).toMatchObject({ fact: "Craters outlast weather.", chapterTitle: "Craters", schedule: { state: "new" } });
    expect(sets.at(-1)!.cues.map((cue) => cue.question)).toEqual(["What outlasts any weather on a moon?", "Why do old surfaces show the most craters?"]);
    expect(await pendingSuggestions()).toEqual([]);
    await expect(decideSuggestion(suggestionId, "reject")).rejects.toThrow(SuggestionError);
  });

  it("leave the book alone when rejected", async () => {
    const before = (await readBookState(bookId)).cardSets;
    const { suggestionId } = await call<{ suggestionId: string }>("propose_card", { ...proposal(await craterAnchor()), fact: "Another fact.", cards: [{ question: "A new question?", answer: "Yes." }] });
    expect(await decideSuggestion(suggestionId, "reject")).toMatchObject({ status: "rejected" });
    expect((await readBookState(bookId)).cardSets).toEqual(before);
    expect((await listSuggestions("rejected")).map((entry) => entry.id)).toEqual([suggestionId]);
  });

  it("are refused when they aren't a card for a passage of that book", async () => {
    const anchor = await craterAnchor();
    expect(await refusal("propose_card", { ...proposal(anchor), anchor: { kind: "pdf", page: 1, start: 0, end: 4 } })).toContain('an "anchor" of the kind "epub"');
    expect(await refusal("propose_card", { ...proposal(anchor), cards: [{ question: "No answer?" }] })).toContain('"question" and "answer"');
    expect(await refusal("propose_card", { ...proposal(anchor), cards: [] })).toContain("one to three");
    expect(await listSuggestions("pending")).toEqual([]);
  });

  it("stop being taken when too many wait, and keep only the newest decided", () => {
    const suggestion = (n: number): CardSuggestion => ({ id: `s${n}`, kind: "card", target: { bookId, anchor: { kind: "epub", cfi: "epubcfi(/6/2)" } }, payload: { quote: "q", chapterTitle: null, fact: "f", cards: [] }, proposer: "a", createdAt: "", status: "pending", decidedAt: null });
    let file = emptySuggestions();
    for (let n = 0; n < MAX_PENDING; n++) file = withProposed(file, suggestion(n))!;
    expect(withProposed(file, suggestion(MAX_PENDING))).toBeNull();

    const now = new Date(0);
    file = { suggestions: Array.from({ length: MAX_DECIDED + 2 }, (_, n) => suggestion(n)) };
    for (let n = 0; n < MAX_DECIDED + 1; n++) file = withDecision(file, `s${n}`, "rejected", now);
    expect(file.suggestions.map((entry) => entry.id)).toEqual(Array.from({ length: MAX_DECIDED + 1 }, (_, n) => `s${n + 1}`));
    expect(withDecision(file, "s1", "accepted", now)).toBe(file);
  });
});

describe("the MCP server", () => {
  /** Sends the lines to a fresh server and returns its replies by request id, once it has answered them all. */
  const talk = async (messages: Record<string, unknown>[]) => {
    const input = new PassThrough();
    const output = new PassThrough();
    let text = "";
    output.on("data", (chunk) => (text += chunk));
    const served = serve(input, output);
    input.end(messages.map((message) => (typeof message.raw === "string" ? message.raw : JSON.stringify({ jsonrpc: "2.0", ...message }))).join("\n") + "\n");
    await served;
    const replies = text.trimEnd().split("\n").map((line) => JSON.parse(line) as { jsonrpc: string; id: number | null; result?: Record<string, unknown>; error?: { code: number; message: string } });
    return (id: number | null) => replies.find((reply) => reply.id === id)!;
  };
  const hello = { id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2" } } };
  const ready = { method: "notifications/initialized" };

  it("shakes hands and lists every tool with its schema", async () => {
    const reply = await talk([hello, ready, { id: 2, method: "tools/list" }, { id: 3, method: "ping" }]);
    expect(reply(1).result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "rigg-learn" } });
    const tools = reply(2).result!.tools as { name: string; inputSchema: { type: string }; annotations: { readOnlyHint: boolean } }[];
    expect(tools.map((tool) => tool.name)).toEqual(TOOLS.map((tool) => tool.name));
    expect(tools.every((tool) => tool.inputSchema.type === "object")).toBe(true);
    expect(tools.filter((tool) => !tool.annotations.readOnlyHint).map((tool) => tool.name)).toEqual(["park_question", "log_activity", "propose_card"]);
    expect(reply(3).result).toEqual({});
  });

  it("runs tools, names the client in the log, and reports a refusal as a tool error", async () => {
    const reply = await talk([
      { ...hello, params: { ...hello.params, clientInfo: { name: "codex-mcp-client" }, protocolVersion: "1999-01-01" } },
      ready,
      { id: 2, method: "tools/call", params: { name: "list_library", arguments: {} } },
      { id: 3, method: "tools/call", params: { name: "get_thread", arguments: { bookId, threadId: "none" } } },
    ]);
    expect(reply(1).result!.protocolVersion).toBe("2025-06-18");
    const listed = reply(2).result as { content: { type: string; text: string }[]; isError?: boolean };
    expect(listed.isError).toBeUndefined();
    expect(JSON.parse(listed.content[0].text).books[0].id).toBe(bookId);
    expect(reply(3).result).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringContaining("Call list_threads") }] });
    /* Calls run side by side, so the log has them in the order they finished. */
    const logged = (await readToolLog()).filter((entry) => entry.caller === "codex-mcp-client").map((entry) => `${entry.tool} ${entry.outcome}`);
    expect(logged.sort()).toEqual(["get_thread refused", "list_library ok"]);
  });

  it("answers what it doesn't understand with a JSON-RPC error and keeps going", async () => {
    const reply = await talk([{ raw: "not json" }, { id: 5, method: "resources/list" }, { id: 6, method: "tools/call", params: {} }, { id: 7, method: "ping" }]);
    expect(reply(null).error).toMatchObject({ code: -32700 });
    expect(reply(5).error).toMatchObject({ code: -32601 });
    expect(reply(6).error).toMatchObject({ code: -32602 });
    expect(reply(7).result).toEqual({});
  });
});
