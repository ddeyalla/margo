import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claudeArgs, parseClaudeLine } from "@/lib/server/tutor/claude";
import { codexArgs, createCodexParser } from "@/lib/server/tutor/codex";
import { childEnv } from "@/lib/server/tutor/process";
import { TUTOR_SYSTEM, buildTurn, cliPrompt } from "@/lib/server/tutor/prompt";
import type { TutorEvent, TutorTurn } from "@/lib/server/tutor/types";
import type { Thread } from "@/lib/shared/types";

/* Fixtures are real CLI output (claude 2.1.322, codex-cli 0.167.1) with paths and account fields removed. */
const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8").split("\n").filter(Boolean);

const collect = (lines: string[], parse: (line: string) => TutorEvent[]) => {
  const events = lines.flatMap(parse);
  return {
    text: events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join(""),
    sessions: events.flatMap((e) => (e.type === "session" ? [e.id] : [])),
    errors: events.flatMap((e) => (e.type === "error" ? [e.message] : [])),
  };
};

describe("claude stream-json parser", () => {
  it("reads only text deltas, so the repeated assistant lines and thinking don't leak in", () => {
    const result = collect(fixture("claude-stream.jsonl"), parseClaudeLine);
    expect(result).toEqual({ text: "two short words.", sessions: ["6abccc1d-d06f-4061-b795-8c64afbcb754"], errors: [] });
  });

  it("reads a resumed session the same way", () => {
    expect(collect(fixture("claude-resume.jsonl"), parseClaudeLine).text).toBe('"two short words."');
  });

  it("reports a lost session from the result line's errors", () => {
    expect(collect(fixture("claude-lost-session.jsonl"), parseClaudeLine).errors).toEqual([
      "No conversation found with session ID: 00000000-0000-0000-0000-000000000000",
    ]);
  });

  it("ignores lines that are not JSON", () => {
    expect(parseClaudeLine("Loading...")).toEqual([]);
  });
});

describe("codex exec --json parser", () => {
  it("reports a usage limit once and treats error items as warnings", () => {
    expect(collect(fixture("codex-usage-limit.jsonl"), createCodexParser())).toEqual({
      text: "",
      sessions: ["01a1d4ad-bdd5-7173-9bd8-18939b2c2c33"],
      errors: [expect.stringContaining("You’ve hit your usage limit.")],
    });
  });

  it("reports an unsupported model once", () => {
    expect(collect(fixture("codex-unsupported-model.jsonl"), createCodexParser()).errors).toEqual([
      "The 'gpt-6.1-terra' model is not supported when using Codex with a ChatGPT account.",
    ]);
  });

  it("joins agent messages as paragraphs", () => {
    /* Not captured: this account's quota ran out. The shape follows rigg-video's codex fixture. */
    const lines = [
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"First paragraph."}}',
      '{"type":"item.completed","item":{"id":"item_2","type":"reasoning","text":"thinking"}}',
      '{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"Second."}}',
    ];
    expect(collect(lines, createCodexParser()).text).toBe("First paragraph.\n\nSecond.");
  });
});

const turn = (overrides: Partial<TutorTurn> = {}): TutorTurn => ({
  system: "Be a tutor.",
  messages: [{ role: "user", content: "Explain this passage." }],
  sessionId: null,
  model: null,
  ...overrides,
});

describe("CLI arguments", () => {
  it("puts the claude prompt right after --print and the variadic --tools last", () => {
    const args = claudeArgs(turn({ sessionId: "abc", model: "claude-fable-5-2" }));
    expect(args.slice(0, 2)).toEqual(["--print", "Explain this passage."]);
    expect(args).toEqual(expect.arrayContaining(["--safe-mode", "--strict-mcp-config", "--resume", "abc", "--model", "claude-fable-5-2"]));
    expect(args.slice(-2)).toEqual(["--tools", ""]);
  });

  it("keeps a message that starts with a dash from reading as a flag", () => {
    expect(claudeArgs(turn({ messages: [{ role: "user", content: "-why?" }] }))[1]).toBe(" -why?");
    const resume = codexArgs(turn({ sessionId: "s1", messages: [{ role: "user", content: "-why?" }] }), "/tmp/x");
    expect(resume.slice(-3)).toEqual(["--", "s1", "-why?"]);
    expect(resume).not.toContain("-s");
    expect(resume).not.toContain("-C");
  });

  it("starts a codex thread with the tutor instructions in its read-only sandbox", () => {
    const args = codexArgs(turn(), "/tmp/scratch");
    expect(args).toEqual(expect.arrayContaining(["-s", "read-only", "-C", "/tmp/scratch", "-m", "gpt-6-luna"]));
    expect(args.at(-1)).toMatch(/^Be a tutor\.\n\n---\n\nExplain this passage\.$/);
  });
});

describe("tutor turns", () => {
  const thread: Thread = {
    id: "t1",
    anchor: { kind: "pdf", page: 3, start: 10, end: 40 },
    quote: "The selected words.",
    before: "Words before.",
    after: "Words after.",
    chapterTitle: "Chapter 2, p. 3",
    action: "ask",
    provider: "claude",
    sessionId: null,
    createdAt: "2026-11-13T00:00:00.000Z",
    messages: [
      { role: "user", content: "What does this mean?", createdAt: "" },
      { role: "assistant", content: "It means X.", createdAt: "" },
      { role: "user", content: "Why?", createdAt: "" },
    ],
  };

  it("expands the first message into the book, place, passage, surroundings and question", () => {
    const first = buildTurn({ title: "A Book", author: "An Author" }, thread, null).messages[0].content;
    expect(first).toContain("Book: A Book, by An Author");
    expect(first).toContain("Where: Chapter 2, p. 3");
    expect(first).toContain("<before>\nWords before.\n</before>");
    expect(first).toContain("<selection>\nThe selected words.\n</selection>");
    expect(first).toContain("<after>\nWords after.\n</after>");
    expect(first.endsWith("My question: What does this mean?")).toBe(true);
  });

  it("sends a CLI only the new message when it resumes its session, else the whole conversation", () => {
    const fresh = buildTurn({ title: "A Book", author: null }, thread, null);
    expect(fresh.system).toBe(TUTOR_SYSTEM);
    expect(cliPrompt(fresh)).toContain("Tutor:\nIt means X.");
    expect(cliPrompt(fresh).endsWith("The reader's new message:\nWhy?")).toBe(true);
    expect(cliPrompt({ ...fresh, sessionId: "s1" })).toBe("Why?");
  });
});

describe("child environment", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("passes only allowlisted variables and never an API key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-secret");
    vi.stubEnv("GITHUB_TOKEN", "ghp-secret");
    vi.stubEnv("ANTHROPIC_BASE_URL", "http://localhost:1");
    vi.stubEnv("OPENAI_ORG", "");
    const env = childEnv();
    expect(env.HOME).toBe(process.env.HOME);
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.ANTHROPIC_BASE_URL).toBe("http://localhost:1");
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("GITHUB_TOKEN");
    expect(env).not.toHaveProperty("OPENAI_ORG");
  });
});
