import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiMessages } from "@/lib/server/tutor/api";
import { claudeArgs, claudeInput, parseClaudeLine } from "@/lib/server/tutor/claude";
import { codexArgs, createCodexParser } from "@/lib/server/tutor/codex";
import { childEnv } from "@/lib/server/tutor/process";
import { TUTOR_SYSTEM, buildTurn, cliInput } from "@/lib/server/tutor/prompt";
import type { TutorEvent, TutorImage, TutorTurn } from "@/lib/server/tutor/types";
import type { ImageAttachment, Thread } from "@/lib/shared/types";

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
  messages: [{ role: "user", content: "Explain this passage.", images: [] }],
  sessionId: null,
  model: null,
  ...overrides,
});

const diagram: TutorImage = { mediaType: "image/png", data: "UE5H" };
const photo: TutorImage = { mediaType: "image/jpeg", data: "SlBFRw==" };

/** Reader, tutor, reader: the first message shares a diagram, the follow-up a photo. */
const imageTurn = (sessionId: string | null): TutorTurn =>
  turn({
    sessionId,
    messages: [
      { role: "user", content: "What is this?", images: [diagram] },
      { role: "assistant", content: "A diagram.", images: [] },
      { role: "user", content: "And this?", images: [photo] },
    ],
  });

describe("CLI arguments", () => {
  it("has claude read the message from stdin and keeps the variadic --tools last", () => {
    const args = claudeArgs(turn({ sessionId: "abc", model: "claude-fable-5-2" }));
    expect(args.slice(0, 3)).toEqual(["--print", "--input-format", "stream-json"]);
    expect(args).not.toContain("Explain this passage.");
    expect(args).toEqual(expect.arrayContaining(["--safe-mode", "--strict-mcp-config", "--resume", "abc", "--model", "claude-fable-5-2"]));
    expect(args.slice(-2)).toEqual(["--tools", ""]);
  });

  it("keeps a codex message that starts with a dash from reading as a flag", () => {
    const resume = codexArgs(turn({ sessionId: "s1", messages: [{ role: "user", content: "-why?", images: [] }] }), "/tmp/x");
    expect(resume.slice(-3)).toEqual(["--", "s1", "-why?"]);
    expect(resume).not.toContain("-s");
    expect(resume).not.toContain("-C");
  });

  it("starts a codex thread with the tutor instructions in its read-only sandbox", () => {
    const args = codexArgs(turn(), "/tmp/scratch");
    expect(args).toEqual(expect.arrayContaining(["-s", "read-only", "-C", "/tmp/scratch", "-m", "gpt-6-luna"]));
    expect(args).not.toContain("-i");
    expect(args.at(-1)).toMatch(/^Be a tutor\.\n\n---\n\nExplain this passage\.$/);
  });

  it("gives codex each image as its own -i, before the -- that ends the files", () => {
    const files = ["/tmp/scratch/images-a/1.png", "/tmp/scratch/images-a/2.jpg"];
    const fresh = codexArgs(turn(), "/tmp/scratch", files);
    const dashes = fresh.indexOf("--");
    expect(fresh.slice(dashes - 4, dashes)).toEqual(["-i", files[0], "-i", files[1]]);
    expect(fresh.slice(dashes + 1)).toHaveLength(1);

    const resumed = codexArgs(turn({ sessionId: "s1" }), "/tmp/scratch", files.slice(0, 1));
    expect(resumed.slice(0, 2)).toEqual(["exec", "resume"]);
    expect(resumed.slice(-5)).toEqual(["-i", files[0], "--", "s1", "Explain this passage."]);
  });
});

describe("claude stream-json input", () => {
  const read = (line: string) => {
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trimEnd()).not.toContain("\n");
    return JSON.parse(line);
  };

  it("is one user message line: images as base64 blocks, then the words", () => {
    const resumed = read(claudeInput(imageTurn("s1")));
    expect(resumed).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "SlBFRw==" } },
          { type: "text", text: "And this?" },
        ],
      },
    });
  });

  it("sends just the words when there are no images", () => {
    expect(read(claudeInput(turn())).message.content).toEqual([{ type: "text", text: "Explain this passage." }]);
  });

  it("replays every image in the thread when there is no session to resume", () => {
    const content = read(claudeInput(imageTurn(null))).message.content;
    expect(content.map((block: { type: string }) => block.type)).toEqual(["image", "image", "text"]);
    expect(content[0].source.data).toBe("UE5H");
    expect(content[1].source.data).toBe("SlBFRw==");
    expect(content[2].text).toContain("Reader:\n[Image 1]\nWhat is this?");
    expect(content[2].text).toContain("The reader's new message:\n[Image 2]\nAnd this?");
  });
});

describe("API messages", () => {
  it("puts each turn's images in that turn, including earlier ones, since the API keeps no session", () => {
    expect(apiMessages(imageTurn("ignored"))).toEqual([
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: "UE5H" } },
          { type: "text", text: "What is this?" },
        ],
      },
      { role: "assistant", content: "A diagram." },
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "SlBFRw==" } },
          { type: "text", text: "And this?" },
        ],
      },
    ]);
  });

  it("builds earlier turns the same way on every request, so the cached prefix holds", () => {
    const first = apiMessages(turn({ messages: imageTurn(null).messages.slice(0, 1) }));
    expect(apiMessages(imageTurn(null)).slice(0, 1)).toEqual(first);
  });

  it("keeps a text-only message as plain text", () => {
    expect(apiMessages(turn())).toEqual([{ role: "user", content: "Explain this passage." }]);
  });
});

describe("the tutor's diagrams", () => {
  it("asks for flowcharts without subgraphs, which a whiteboard can't open as shapes", () => {
    expect(TUTOR_SYSTEM).toMatch(/Never group a flowchart's nodes in a subgraph/);
    expect(TUTOR_SYSTEM).toMatch(/flowchart with no subgraph/);
  });

  it("draws on the attached whiteboard instead of a separate diagram, as the board note asks", () => {
    expect(TUTOR_SYSTEM).toMatch(/comes with their whiteboard as JSON[^.]*: there, put the drawing on that board[^.]*, and draw no separate diagram/);
  });
});

describe("tutor turns", () => {
  const thread: Thread = {
    kind: "passage",
    id: "t1",
    anchor: { kind: "pdf", page: 3, start: 10, end: 40 },
    quote: "The selected words.",
    before: "Words before.",
    after: "Words after.",
    chapterTitle: "Chapter 2",
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
  const book = { title: "A Book", author: null };
  const noImages = new Map<string, Buffer>();

  it("expands the first message into the book, place, passage, surroundings and question", () => {
    const first = buildTurn({ title: "A Book", author: "An Author" }, thread, null, noImages).messages[0].content;
    expect(first).toContain("Book: A Book, by An Author");
    expect(first).toContain("Where: Chapter 2, p. 3");
    expect(first).toContain("<before>\nWords before.\n</before>");
    expect(first).toContain("<selection>\nThe selected words.\n</selection>");
    expect(first).toContain("<after>\nWords after.\n</after>");
    expect(first.endsWith("My question: What does this mean?")).toBe(true);
  });

  it("asks the reader to try first on Go deeper, with a way out", () => {
    const deeper: Thread = { ...thread, action: "deeper", messages: [{ role: "user", content: "Go deeper on this passage.", createdAt: "" }] };
    const first = buildTurn(book, deeper, null, noImages).messages[0].content;
    expect(first).toContain("Don't explain yet. Ask me one short question");
    expect(first).toContain("just tell me, explain it straight away");
  });

  it("expands a question with no passage into the book, where the reader is, and the message", () => {
    const general: Thread = {
      kind: "general",
      id: "g1",
      anchor: { kind: "pdf", page: 7, start: 0, end: 0 },
      chapterTitle: "Attention",
      provider: "claude",
      sessionId: null,
      createdAt: "",
      messages: [{ role: "user", content: "Explain this image.", createdAt: "" }],
    };
    expect(buildTurn(book, general, null, noImages).messages[0].content).toBe(
      "Book: A Book\nWhere I am reading: Attention, p. 7\n\nI have not selected a passage.\n\nExplain this image.",
    );
    expect(buildTurn(book, { ...general, anchor: null }, null, noImages).messages[0].content).not.toContain("Where");
  });

  it("sends a CLI only the new message when it resumes its session, else the whole conversation", () => {
    const fresh = buildTurn(book, thread, null, noImages);
    expect(fresh.system).toBe(TUTOR_SYSTEM);
    expect(cliInput(fresh).text).toContain("Tutor:\nIt means X.");
    expect(cliInput(fresh).text.endsWith("The reader's new message:\nWhy?")).toBe(true);
    expect(cliInput(fresh).text).not.toContain("numbered");
    expect(cliInput({ ...fresh, sessionId: "s1" })).toEqual({ text: "Why?", images: [] });
  });

  it("reads each message's images by id and leaves out one whose file is gone", () => {
    const shown: ImageAttachment = { id: "a".repeat(32), mediaType: "image/png", width: 3, height: 2 };
    const gone: ImageAttachment = { ...shown, id: "b".repeat(32) };
    const withImages: Thread = {
      ...thread,
      messages: [...thread.messages.slice(0, 2), { role: "user", content: "Why?", createdAt: "", attachments: [shown, gone] }],
    };
    const built = buildTurn(book, withImages, null, new Map([[shown.id, Buffer.from("PNG")]]));
    expect(built.messages.map((m) => m.images)).toEqual([[], [], [{ mediaType: "image/png", data: "UE5H" }]]);
  });

  it("joins a message sent after an unanswered one, so roles alternate, keeping both messages' images", () => {
    const image: ImageAttachment = { id: "a".repeat(32), mediaType: "image/png", width: 3, height: 2 };
    const unanswered: Thread = {
      ...thread,
      messages: [
        ...thread.messages.slice(0, 2),
        { role: "user", content: "Why?", createdAt: "", attachments: [image] },
        { role: "user", content: "Are you there?", createdAt: "", attachments: [image] },
      ],
    };
    const turn = buildTurn(book, unanswered, null, new Map([[image.id, Buffer.from("PNG")]]));
    expect(turn.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(turn.messages[2].content).toBe("Why?\n\nAre you there?");
    expect(turn.messages[2].images).toHaveLength(2);
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

describe("recap", () => {
  const recap: Thread = {
    kind: "passage",
    id: "r1",
    anchor: { kind: "epub", cfi: "epubcfi(/6/4!/4/2/1:0)" },
    quote: "The last invented sentence.",
    before: "Invented text from earlier in the chapter.",
    after: "Text that must never reach the tutor.",
    chapterTitle: "Chapter Two",
    action: "recap",
    provider: "claude",
    sessionId: null,
    createdAt: "2026-11-13T00:00:00.000Z",
    messages: [{ role: "user", content: "Recap what came before this point.", createdAt: "2026-11-13T00:00:00.000Z" }],
  };

  it("asks for what came before the reader's place, without spoilers, and sends no text after it", () => {
    const first = buildTurn({ title: "A Book", author: null }, recap, null, new Map()).messages[0].content;
    expect(first).toContain("Invented text from earlier in the chapter.");
    expect(first).toContain("The last invented sentence.");
    expect(first).toContain("say nothing about what happens after it");
    expect(first).not.toContain("<after>");
    expect(first).not.toContain("must never reach");
  });
});
