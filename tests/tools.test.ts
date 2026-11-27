import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readActivity } from "@/lib/server/activity";
import { readLibrary } from "@/lib/server/library";
import { serve } from "@/lib/server/mcp/server";
import { readBookState, updateBookState } from "@/lib/server/store";
import { decideSuggestion, listSuggestions, pendingSuggestions, SuggestionError, suggestionsFile } from "@/lib/server/suggestions";
import { callTool, TOOLS } from "@/lib/server/tools";
import { readToolLog, summarizeArgs } from "@/lib/server/tools/log";
import { jsonSchema, parseInput, ToolError } from "@/lib/server/tools/schema";
import { addCards } from "@/lib/shared/cards";
import { isParked } from "@/lib/shared/parked";
import { emptySuggestions, MAX_DECIDED, MAX_PENDING, withDecision, withProposed, type CardSuggestion } from "@/lib/shared/suggestions";
import type { Anchor, BookId } from "@/lib/shared/types";
import { makeEpub } from "./fixtures/books";

/* propose_card checks each card with a model. Here the model is scripted: a question holding "BAD" can't be answered from its passage. */
vi.mock("@/lib/server/check/provider", async (original) => {
  const { ANSWER_SYSTEM } = await import("@/lib/server/check/verify");
  const provider = {
    id: "api",
    label: "Scripted",
    probe: async () => ({ status: "ready", detail: null, version: null }),
    async *run(turn: { system: string; messages: { content: string }[] }) {
      const request = turn.messages.at(-1)!.content;
      const reply =
        turn.system !== ANSWER_SYSTEM
          ? { matches: true, supported: true, reason: "Same." }
          : request.includes("BAD")
            ? { answerable: false, reason: "The passage doesn't say." }
            : { answerable: true, answer: "Its craters.", evidence: "Impacts leave craters" };
      yield { type: "text", delta: JSON.stringify(reply) };
    },
  };
  return { ...(await original<typeof import("@/lib/server/check/provider")>()), defaultChecker: async () => ({ provider, model: "scripted" }) };
});

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
  it("names every tool once, offers nothing that reaches the web, and runs a model only to check and grade", () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((name) => /web|fetch|http|url|ask_tutor|chat/.test(name))).toEqual([]);
    expect(TOOLS.filter((tool) => tool.effect === "write").map((tool) => tool.name)).toEqual(["park_question", "log_activity", "record_evidence"]);
    expect(TOOLS.filter((tool) => /verify|grade/.test(tool.name)).map((tool) => [tool.name, tool.effect])).toEqual([["verify_item", "read"], ["grade_answer", "read"]]);
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
    expect(await refusal("log_activity", { bookId: "f".repeat(40), kind: "quiz", seconds: 5 })).toContain("Call list_library");
    expect(Object.values((await readActivity()).days)).toEqual(days);
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
    expect(sets.at(-1)!.cues.every((cue) => typeof cue.verifiedAt === "string")).toBe(true);
    expect(await pendingSuggestions()).toEqual([]);
    await expect(decideSuggestion(suggestionId, "reject")).rejects.toThrow(SuggestionError);
  });

  it("carry a prepared session plan that only advises, one a day", async () => {
    const anchor = await craterAnchor();
    const stateBefore = JSON.stringify(await readBookState(bookId));
    const plan = {
      forDay: "2999-01-02",
      note: "Two items were missed.",
      retest: [{ bookId, topic: "Why craters last", chapter: "Craters", anchor, why: "Missed twice." }],
      exercises: [{ bookId, topic: "Craters", anchor, prompt: "Explain why old surfaces show the most craters.", why: "You are here." }],
      questions: [{ bookId, question: "What is a maria?" }],
    };
    const first = await call<{ suggestionId: string; status: string; retest: number; exercises: number; questions: number }>("propose_session_plan", plan, "prep-agent");
    expect(first).toMatchObject({ status: "pending", retest: 1, exercises: 1, questions: 1 });
    expect(JSON.stringify(await readBookState(bookId))).toBe(stateBefore);
    const again = await call<{ suggestionId: string }>("propose_session_plan", { ...plan, note: "Updated." }, "prep-agent");
    const pending = (await listSuggestions("pending")).filter((entry) => entry.kind === "plan");
    expect(pending).toMatchObject([{ id: again.suggestionId, payload: { note: "Updated.", forDay: "2999-01-02" }, target: { bookId: null } }]);
    expect(await pendingSuggestions()).toMatchObject([{ id: again.suggestionId, bookTitle: null }]);

    expect(await decideSuggestion(again.suggestionId, "accept")).toMatchObject({ status: "accepted" });
    expect(JSON.stringify(await readBookState(bookId))).toBe(stateBefore);
  });

  it("refuse a plan that is empty, for a past day, or names a book or place that isn't there", async () => {
    const anchor = await craterAnchor();
    const item = { bookId, topic: "Craters", why: "Missed." };
    expect(await refusal("propose_session_plan", {})).toMatch(/at least one/);
    expect(await refusal("propose_session_plan", { forDay: "2001-01-01", retest: [item] })).toMatch(/has passed/);
    expect(await refusal("propose_session_plan", { forDay: "soon", retest: [item] })).toMatch(/date like/);
    expect(await refusal("propose_session_plan", { retest: [{ ...item, bookId: "nope" }] })).toMatch(/No book/);
    expect(await refusal("propose_session_plan", { retest: [{ ...item, anchor: { kind: "pdf", page: 1, start: 0, end: 1 } }] })).toMatch(/not a place/);
    expect(await refusal("propose_session_plan", { exercises: [{ ...item, prompt: "Q?" }] })).toMatch(/anchor/);
    expect(await refusal("propose_session_plan", { exercises: [{ bookId, topic: "Craters", anchor, why: "x" }] })).toMatch(/prompt/);
    expect((await listSuggestions("pending")).filter((entry) => entry.kind === "plan")).toEqual([]);
  });

  it("leave out a card that fails the check against the passage, say why, and add only the ones that passed", async () => {
    const cards = [
      { question: "What do impacts leave behind?", answer: "Craters." },
      { question: "How wide is the BAD crater?", answer: "Ten miles." },
    ];
    const proposed = await call<{ suggestionId: string; status: string; verified: number; failed: unknown[] }>("propose_card", { ...proposal(await craterAnchor()), fact: "Impacts leave craters.", cards });
    expect(proposed).toMatchObject({ status: "pending", verified: 1, failed: [{ question: "How wide is the BAD crater?", reason: "The passage doesn't say." }] });
    const [waiting] = (await pendingSuggestions()) as { payload: CardSuggestion["payload"] }[];
    expect(waiting.payload.cards).toEqual([{ ...cards[0], verifiedAt: expect.any(String) }]);
    expect(waiting.payload.failed).toEqual([{ ...cards[1], reason: "The passage doesn't say." }]);

    const before = (await readBookState(bookId)).cardSets.flatMap((set) => set.cues).length;
    await decideSuggestion(proposed.suggestionId, "accept");
    const cues = (await readBookState(bookId)).cardSets.flatMap((set) => set.cues);
    expect(cues).toHaveLength(before + 1);
    expect(cues.some((cue) => cue.question.includes("BAD"))).toBe(false);
  });

  it("never reach the reader when no card passes, and stay on record as failed with why", async () => {
    const before = (await readBookState(bookId)).cardSets;
    const proposed = await call<{ suggestionId: string; status: string; verified: number }>("propose_card", { ...proposal(await craterAnchor()), fact: "A made-up fact.", cards: [{ question: "Who named the BAD crater?", answer: "Nobody knows." }] });
    expect(proposed).toMatchObject({ status: "failed", verified: 0, failed: [{ question: "Who named the BAD crater?", reason: "The passage doesn't say." }] });
    expect(await pendingSuggestions()).toEqual([]);
    expect(await call("list_suggestions", { status: "failed" })).toMatchObject({ suggestions: [{ id: proposed.suggestionId, payload: { cards: [], failed: [{ reason: "The passage doesn't say." }] } }] });
    await expect(decideSuggestion(proposed.suggestionId, "accept")).rejects.toThrow(/already failed/);
    expect((await readBookState(bookId)).cardSets).toEqual(before);
  });

  it("can't be accepted when they were proposed before cards were checked", async () => {
    const old: CardSuggestion = {
      id: "from-before",
      kind: "card",
      target: { bookId, anchor: await craterAnchor() },
      payload: { quote: "Impacts leave craters that outlast any weather.", chapterTitle: "Craters", fact: "An unchecked fact.", cards: [{ question: "An unchecked question?", answer: "Maybe." }] },
      proposer: "old-agent",
      createdAt: "2026-11-01T00:00:00.000Z",
      status: "pending",
      decidedAt: null,
    };
    const file = JSON.parse(await readFile(suggestionsFile(), "utf8")) as { suggestions: CardSuggestion[] };
    await writeFile(suggestionsFile(), JSON.stringify(withProposed(file, old)));
    const before = (await readBookState(bookId)).cardSets;
    await expect(decideSuggestion("from-before", "accept")).rejects.toThrow(/before cards were checked/);
    expect((await readBookState(bookId)).cardSets).toEqual(before);
    expect(await decideSuggestion("from-before", "reject")).toMatchObject({ status: "rejected" });
  });

  it("leave the book alone when rejected", async () => {
    const before = (await readBookState(bookId)).cardSets;
    const { suggestionId } = await call<{ suggestionId: string }>("propose_card", { ...proposal(await craterAnchor()), fact: "Another fact.", cards: [{ question: "A new question?", answer: "Yes." }] });
    expect(await decideSuggestion(suggestionId, "reject")).toMatchObject({ status: "rejected" });
    expect((await readBookState(bookId)).cardSets).toEqual(before);
    expect((await listSuggestions("rejected")).map((entry) => entry.id)).toContain(suggestionId);
  });

  it("take one decision when accept and reject arrive together", async () => {
    const before = (await readBookState(bookId)).cardSets.flatMap((set) => set.cues).length;
    const { suggestionId } = await call<{ suggestionId: string }>("propose_card", { ...proposal(await craterAnchor()), fact: "A raced fact.", cards: [{ question: "Which decision wins a race?", answer: "The first." }] });
    const outcomes = await Promise.allSettled([decideSuggestion(suggestionId, "accept"), decideSuggestion(suggestionId, "reject")]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["fulfilled", "rejected"]);
    expect((await listSuggestions()).find((entry) => entry.id === suggestionId)).toMatchObject({ status: "accepted" });
    expect((await readBookState(bookId)).cardSets.flatMap((set) => set.cues)).toHaveLength(before + 1);
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
    expect(tools.filter((tool) => !tool.annotations.readOnlyHint).map((tool) => tool.name)).toEqual(["park_question", "log_activity", "propose_card", "propose_session_plan", "record_evidence"]);
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
