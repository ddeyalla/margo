import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BetaUsage } from "@anthropic-ai/sdk/resources/beta/messages";
import { describe, expect, it } from "vitest";
import { readBookState } from "@/lib/server/store";
import { openTurn } from "@/lib/server/turns";
import { apiCost, apiUsage } from "@/lib/server/tutor/api";
import { parseClaudeLine } from "@/lib/server/tutor/claude";
import { createCodexParser } from "@/lib/server/tutor/codex";
import type { BookId, ChatMessage, Thread, TurnUsage } from "@/lib/shared/types";
import { formatCost, formatTokens, threadUsage } from "@/lib/shared/usage";

/* The closing line of a real `claude --print --output-format stream-json` run (Claude Code 2.1.326, signed in with a
   plan), with the fields this app doesn't read taken out. */
const CLAUDE_RESULT = {
  type: "result",
  subtype: "success",
  is_error: false,
  result: "Hi!",
  session_id: "ea0e0706-18c9-4097-8720-a1cb0fefe3af",
  total_cost_usd: 0.016304,
  usage: {
    input_tokens: 2,
    cache_creation_input_tokens: 1003,
    cache_read_input_tokens: 0,
    output_tokens: 6,
    iterations: [{ input_tokens: 2, output_tokens: 6, cache_read_input_tokens: 0, cache_creation_input_tokens: 1003, type: "message" }],
  },
  modelUsage: {
    "claude-fable-5-2": { inputTokens: 2, outputTokens: 6, costUSD: 0.016304, contextWindow: 1000000, costBasis: "list" },
  },
};

const usageOf = (events: ReturnType<typeof parseClaudeLine>) => events.flatMap((event) => (event.type === "usage" ? [event.usage] : []));

describe("Claude Code usage", () => {
  it("reads the closing line's tokens, cost and window, priced at list rates on a plan", () => {
    expect(usageOf(parseClaudeLine(JSON.stringify(CLAUDE_RESULT)))).toEqual([
      {
        provider: "claude",
        model: "claude-fable-5-2",
        scope: "turn",
        sessionId: null,
        inputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 1003,
        outputTokens: 6,
        contextTokens: 1011,
        contextWindow: 1000000,
        costUsd: 0.016304,
        costBasis: "list",
      },
    ]);
  });

  it("sizes the conversation from the last model call, not the sum of all of them", () => {
    const line = {
      ...CLAUDE_RESULT,
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 3000,
        cache_creation_input_tokens: 0,
        output_tokens: 50,
        iterations: [
          { input_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 20 },
          { input_tokens: 5, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0, output_tokens: 30 },
        ],
      },
    };
    expect(usageOf(parseClaudeLine(JSON.stringify(line)))[0].contextTokens).toBe(2035);
  });

  it("keeps the usage of a run that failed, alongside its error", () => {
    const events = parseClaudeLine(JSON.stringify({ ...CLAUDE_RESULT, is_error: true, errors: ["Overloaded"] }));
    expect(events.map((event) => event.type)).toEqual(["usage", "error"]);
  });

  it("gives no cost or window when the line has none, rather than a guess", () => {
    const bare: Record<string, unknown> = { ...CLAUDE_RESULT };
    delete bare.total_cost_usd;
    delete bare.modelUsage;
    const [usage] = usageOf(parseClaudeLine(JSON.stringify(bare)));
    expect([usage.costUsd, usage.costBasis, usage.contextWindow, usage.model]).toEqual([null, null, null, null]);
  });
});

describe("Codex usage", () => {
  it("reads turn.completed as the session's running total, with the cached input split out", () => {
    const parse = createCodexParser();
    parse(JSON.stringify({ type: "thread.started", thread_id: "s1" }));
    const events = parse(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1200, cached_input_tokens: 1000, output_tokens: 40 } }));
    expect(events).toEqual([
      {
        type: "usage",
        usage: expect.objectContaining({ provider: "codex", scope: "session", sessionId: "s1", inputTokens: 200, cacheReadTokens: 1000, outputTokens: 40, contextTokens: null, costUsd: null }),
      },
    ]);
  });

  it("ties a resumed run's totals to the session it resumed", () => {
    const parse = createCodexParser("s1");
    const [event] = parse(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }));
    expect(event.type === "usage" && event.usage.sessionId).toBe("s1");
  });
});

const usage = (over: Partial<BetaUsage>): BetaUsage =>
  ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null, ...over }) as BetaUsage;

describe("API usage", () => {
  it("prices each kind of token at the model's rate", () => {
    const cost = apiCost(
      "claude-sonnet-5-5",
      usage({
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_read_input_tokens: 1_000_000,
        cache_creation_input_tokens: 2_000_000,
        cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 },
      }),
    );
    /* 2 input + 10 output + 0.10 cache read + 2.50 five-minute write + 4 hour write. */
    expect(cost).toBeCloseTo(18.6, 6);
  });

  it("gives no cost for a model it has no price for", () => {
    const turn = apiUsage("claude-some-future-model", usage({ input_tokens: 100, output_tokens: 10 }), null);
    expect([turn.costUsd, turn.costBasis, turn.contextTokens]).toEqual([null, null, 110]);
  });
});

const answer = (u: TurnUsage | undefined): ChatMessage => ({ role: "assistant", content: "A.", createdAt: "", ...(u ? { usage: u } : {}) });
const ask: ChatMessage = { role: "user", content: "Q?", createdAt: "" };
const turnUsage = (over: Partial<TurnUsage>): TurnUsage => ({
  provider: "claude",
  model: null,
  scope: "turn",
  sessionId: null,
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  contextTokens: null,
  contextWindow: null,
  costUsd: null,
  costBasis: null,
  ...over,
});
const thread = (messages: ChatMessage[]): Thread => ({
  kind: "general",
  id: "t",
  anchor: null,
  chapterTitle: null,
  provider: "claude",
  sessionId: null,
  createdAt: "",
  messages,
});

describe("a thread's usage", () => {
  it("counts each Codex answer as its session total less the one before it", () => {
    const codex = (sessionId: string, input: number, output: number) => turnUsage({ provider: "codex", scope: "session", sessionId, inputTokens: input, outputTokens: output });
    const { rows } = threadUsage(thread([ask, answer(codex("s1", 100, 10)), ask, answer(codex("s1", 250, 30)), ask, answer(codex("s2", 80, 5))]));
    expect(rows.map((row) => [row.index, row.tokens.input, row.tokens.output])).toEqual([
      [1, 100, 10],
      [3, 150, 20],
      [5, 80, 5],
    ]);
  });

  it("sums the cost it knows, counts the answers it doesn't, and says when a plan pays", () => {
    const summary = threadUsage(
      thread([
        ask,
        answer(turnUsage({ costUsd: 0.01, costBasis: "api", contextTokens: 900 })),
        ask,
        answer(undefined),
        ask,
        answer(turnUsage({ costUsd: 0.02, costBasis: "list", contextTokens: 1500 })),
      ]),
    );
    expect(summary.costUsd).toBeCloseTo(0.03, 10);
    expect([summary.unpriced, summary.listPriced, summary.latest?.contextTokens]).toEqual([1, true, 1500]);
  });

  it("has no cost at all when no answer has one", () => {
    expect(threadUsage(thread([ask, answer(undefined)])).costUsd).toBeNull();
  });

  it("numbers answers by their place in the thread, counting those that reported nothing", () => {
    const summary = threadUsage(thread([ask, answer(undefined), ask, answer(turnUsage({}))]));
    expect([summary.rows.map((row) => row.answer), summary.unreported]).toEqual([[2], 1]);
  });
});

describe("usage figures", () => {
  it("shortens token counts", () => {
    expect([950, 1011, 1250, 12_400, 312_000, 1_000_000, 1_500_000].map(formatTokens)).toEqual(["950", "1K", "1.3K", "12K", "312K", "1M", "1.5M"]);
  });

  it("shows cents, or a fraction of one", () => {
    expect([0, 0.0042, 0.016304, 0.42, 1.5, 0.00002].map(formatCost)).toEqual(["$0", "$0.0042", "$0.02", "$0.42", "$1.50", "<$0.0001"]);
  });
});

describe("saving usage", () => {
  it("keeps the provider's usage on the saved answer", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-usage-"));
    const bookId = "c".repeat(40) as BookId;
    const opened = await openTurn(bookId, { kind: "new", thread: thread([ask]) }, "claude", dir);
    if (typeof opened === "string") throw new Error(opened);
    const reported = turnUsage({ inputTokens: 5, outputTokens: 7, costUsd: 0.001, costBasis: "api" });
    await opened.close({ text: "An answer.", sessionId: null, partial: false, usage: reported });
    expect((await readBookState(bookId, dir)).threads[0].messages[1].usage).toEqual(reported);
  });
});
