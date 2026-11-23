import { positiveOrNull, tokenCount } from "@/lib/shared/usage";
import type { TurnUsage } from "@/lib/shared/types";
import { isObject } from "../validate";
import { cliInput, imageBlock } from "./prompt";
import { lastErrorLine, parseJsonLine, runQuiet, scratchDir, streamCli } from "./process";
import type { Provider, TutorEvent, TutorTurn } from "./types";

/**
 * Flags for a tools-free, streamed answer. The message goes on stdin as
 * stream-json, the one way to hand the CLI images; --print with
 * --input-format stream-json also works with --resume, and a resume of a lost
 * session still fails with "No conversation found" (checked on Claude Code
 * 2.1.322). The stdin line is built by claudeInput. --safe-mode skips the
 * user's hooks, plugins and CLAUDE.md, which would otherwise leak into the
 * tutor. --tools comes last because it takes every value that follows it.
 */
export const claudeArgs = (turn: TutorTurn): string[] => {
  const args = [
    "--print",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--safe-mode",
    "--strict-mcp-config",
    "--system-prompt", turn.system,
  ];
  if (turn.model) args.push("--model", turn.model);
  if (turn.sessionId) args.push("--resume", turn.sessionId);
  args.push("--tools", "");
  return args;
};

/** The reader's message as the one stream-json line the CLI reads from stdin: images first, then the words. */
export const claudeInput = (turn: TutorTurn): string => {
  const { text, images } = cliInput(turn);
  const content = [...images.map(imageBlock), { type: "text", text }];
  return `${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`;
};

/**
 * One line of `claude --print --output-format stream-json`. Text comes only
 * from stream_event text deltas; the `assistant` lines repeat the same text in
 * full, so reading both would double it.
 */
export const parseClaudeLine = (line: string): TutorEvent[] => {
  const event = parseJsonLine(line);
  if (!event) return [];
  if (event.type === "system" && event.subtype === "init" && typeof event.session_id === "string") {
    return [{ type: "session", id: event.session_id }];
  }
  if (event.type === "stream_event") {
    const inner = event.event as { type?: string; delta?: { type?: string; text?: unknown } } | undefined;
    if (inner?.type === "content_block_delta" && inner.delta?.type === "text_delta" && typeof inner.delta.text === "string") {
      return [{ type: "text", delta: inner.delta.text }];
    }
  }
  if (event.type === "result") {
    const usage = claudeUsage(event);
    const events: TutorEvent[] = usage ? [{ type: "usage", usage }] : [];
    if (event.is_error !== true) return events;
    const errors = Array.isArray(event.errors) ? event.errors.filter((e): e is string => typeof e === "string") : [];
    const message = errors.join("\n") || (typeof event.result === "string" && event.result) || "Claude Code could not answer.";
    return [...events, { type: "error", message }];
  }
  return [];
};

/**
 * The usage on the closing `result` line. `usage` sums every model call in the run and `iterations` lists them, so
 * the conversation's size is the last call's input plus what was written. `modelUsage` names the model with its
 * window and says whether the cost is billed or, on a Claude plan, only priced at list rates.
 */
export const claudeUsage = (event: Record<string, unknown>): TurnUsage | null => {
  if (!isObject(event.usage)) return null;
  const usage = event.usage;
  const calls = Array.isArray(usage.iterations) ? usage.iterations.filter(isObject) : [];
  const last = calls.at(-1) ?? usage;
  const [model, perModel] = Object.entries(isObject(event.modelUsage) ? event.modelUsage : {}).findLast(([, value]) => isObject(value)) ?? [null, null];
  const details = isObject(perModel) ? perModel : {};
  const outputTokens = tokenCount(usage.output_tokens);
  return {
    provider: "claude",
    model,
    scope: "turn",
    sessionId: null,
    inputTokens: tokenCount(usage.input_tokens),
    cacheReadTokens: tokenCount(usage.cache_read_input_tokens),
    cacheWriteTokens: tokenCount(usage.cache_creation_input_tokens),
    outputTokens,
    contextTokens:
      tokenCount(last.input_tokens) + tokenCount(last.cache_read_input_tokens) + tokenCount(last.cache_creation_input_tokens) + tokenCount(last.output_tokens),
    contextWindow: positiveOrNull(details.contextWindow),
    costUsd: typeof event.total_cost_usd === "number" && event.total_cost_usd >= 0 ? event.total_cost_usd : null,
    costBasis: typeof event.total_cost_usd !== "number" ? null : details.costBasis === "list" ? "list" : "api",
  };
};

const LOST_SESSION = /no conversation found/i;

async function* run(turn: TutorTurn, signal: AbortSignal): AsyncGenerator<TutorEvent> {
  let lostSession = false;
  for await (const event of streamCli({
    command: "claude",
    args: claudeArgs(turn),
    cwd: await scratchDir("claude"),
    signal,
    input: claudeInput(turn),
    parseLine: parseClaudeLine,
    describeExit: (code, stderr) => lastErrorLine(stderr) ?? `Claude Code exited with code ${code}.`,
  })) {
    if (event.type === "error" && turn.sessionId && LOST_SESSION.test(event.message)) {
      lostSession = true;
      break;
    }
    yield event;
  }
  /* The CLI forgot the session (its scratch folder was cleared): replay the whole thread instead. */
  if (lostSession) yield* run({ ...turn, sessionId: null }, signal);
}

export const claude: Provider = {
  id: "claude",
  label: "Claude Code",
  async probe() {
    const [version, auth] = await Promise.all([runQuiet("claude", ["--version"]), runQuiet("claude", ["auth", "status"])]);
    if (!version) return { status: "missing", detail: "Install Claude Code to use it here.", version: null };
    const label = version.stdout.trim().split(/\s/)[0] || null;
    let loggedIn = false;
    try {
      loggedIn = JSON.parse(auth?.stdout ?? "").loggedIn === true;
    } catch {
      loggedIn = false;
    }
    return loggedIn
      ? { status: "ready", detail: "Signed in", version: label }
      : { status: "needs-auth", detail: "Run `claude` in a terminal and sign in.", version: label };
  },
  run,
};
