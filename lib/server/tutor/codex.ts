import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { IMAGE_EXTENSIONS } from "@/lib/shared/attachments";
import type { TurnUsage } from "@/lib/shared/types";
import { tokenCount } from "@/lib/shared/usage";
import { isObject } from "../validate";
import { cliInput } from "./prompt";
import { lastErrorLine, parseJsonLine, runQuiet, scratchDir, streamCli } from "./process";
import type { Provider, TutorEvent, TutorImage, TutorTurn } from "./types";

/**
 * The model when settings name none. The CLI's own default may be one a
 * ChatGPT sign-in can't use, which fails every turn.
 */
export const CODEX_DEFAULT_MODEL = "gpt-6-luna";

/**
 * A read-only run in an empty folder. Codex has no system-prompt flag, so a new
 * thread's prompt starts with the tutor instructions. `exec resume` takes no
 * -s or -C, so the sandbox goes through -c and the folder through the spawn cwd.
 * Each image is its own -i, since `exec`'s -i takes every file that follows it.
 * `--` ends the files and keeps a message that starts with "-" from reading as
 * a flag.
 */
export const codexArgs = (turn: TutorTurn, cwd: string, images: string[] = []): string[] => {
  const model = turn.model ?? CODEX_DEFAULT_MODEL;
  const { text } = cliInput(turn);
  const imageArgs = images.flatMap((file) => ["-i", file]);
  if (turn.sessionId) {
    return ["exec", "resume", "--json", "--skip-git-repo-check", "-c", 'sandbox_mode="read-only"', "-m", model, ...imageArgs, "--", turn.sessionId, text];
  }
  const prompt = `${turn.system}\n\n---\n\n${text}`;
  return ["exec", "--json", "--skip-git-repo-check", "-s", "read-only", "-C", cwd, "-m", model, ...imageArgs, "--", prompt];
};

/** Writes a run's images into a folder of their own inside the scratch folder, never near the books. */
const writeImages = async (cwd: string, images: TutorImage[]): Promise<{ dir: string; files: string[] } | null> => {
  if (!images.length) return null;
  const dir = await mkdtemp(path.join(cwd, "images-"));
  /* A temp folder made at run time; the ignore keeps Turbopack from tracing the whole project into the standalone build. */
  const files = images.map((image, index) => path.join(/*turbopackIgnore: true*/ dir, `${index + 1}.${IMAGE_EXTENSIONS[image.mediaType]}`));
  await Promise.all(images.map((image, index) => writeFile(files[index], Buffer.from(image.data, "base64"))));
  return { dir, files };
};

/**
 * The usage on `turn.completed`. `codex exec` reports the session's running total there, not the turn's
 * (`usage_from_last_total` in codex-rs/exec), and gives neither the window nor a cost. Its input count includes
 * the cached part, which is split out here to match the other providers.
 */
export const codexUsage = (value: unknown, sessionId: string | null): TurnUsage | null => {
  if (!isObject(value)) return null;
  const cached = tokenCount(value.cached_input_tokens);
  return {
    provider: "codex",
    model: null,
    scope: "session",
    sessionId,
    inputTokens: Math.max(0, tokenCount(value.input_tokens) - cached),
    cacheReadTokens: cached,
    cacheWriteTokens: tokenCount(value.cache_write_input_tokens),
    outputTokens: tokenCount(value.output_tokens),
    contextTokens: null,
    contextWindow: null,
    costUsd: null,
    costBasis: null,
  };
};

/**
 * A parser for one run of `codex exec --json`. Answers arrive as whole
 * `agent_message` items, so items after the first are set apart as paragraphs.
 * Top-level `error` lines are skipped: they repeat the turn.failed message or
 * report a reconnect that may still succeed. Items of type "error" are warnings.
 */
export const createCodexParser = (resumed: string | null = null) => {
  let sawText = false;
  /* The session the usage totals run over: the one resumed, or the one this run starts. */
  let session = resumed;
  return (line: string): TutorEvent[] => {
    const event = parseJsonLine(line);
    if (!event) return [];
    if (event.type === "thread.started" && typeof event.thread_id === "string") {
      session = event.thread_id;
      return [{ type: "session", id: event.thread_id }];
    }
    if (event.type === "turn.completed") {
      const usage = codexUsage(event.usage, session);
      return usage ? [{ type: "usage", usage }] : [];
    }
    if (event.type === "turn.failed") {
      const message = (event.error as { message?: unknown } | undefined)?.message;
      return [{ type: "error", message: typeof message === "string" && message ? message : "Codex could not answer." }];
    }
    const item = event.item as { type?: string; text?: unknown } | undefined;
    if (event.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string" && item.text) {
      const delta = (sawText ? "\n\n" : "") + item.text;
      sawText = true;
      return [{ type: "text", delta }];
    }
    return [];
  };
};

const LOST_SESSION = /no rollout found/i;

async function* run(turn: TutorTurn, signal: AbortSignal): AsyncGenerator<TutorEvent> {
  const cwd = await scratchDir("codex");
  let lostSession = false;
  const images = await writeImages(cwd, cliInput(turn).images);
  try {
    for await (const event of streamCli({
      command: "codex",
      args: codexArgs(turn, cwd, images?.files),
      cwd,
      signal,
      parseLine: createCodexParser(turn.sessionId),
      describeExit: (code, stderr) => lastErrorLine(stderr) ?? `Codex exited with code ${code}.`,
    })) {
      if (event.type === "error" && turn.sessionId && LOST_SESSION.test(event.message)) {
        lostSession = true;
        break;
      }
      yield event.type === "usage" ? { ...event, usage: { ...event.usage, model: turn.model ?? CODEX_DEFAULT_MODEL } } : event;
    }
  } finally {
    if (images) await rm(images.dir, { recursive: true, force: true });
  }
  if (lostSession) yield* run({ ...turn, sessionId: null }, signal);
}

export const codex: Provider = {
  id: "codex",
  label: "Codex",
  async probe() {
    const [version, login] = await Promise.all([runQuiet("codex", ["--version"]), runQuiet("codex", ["login", "status"])]);
    if (!version) return { status: "missing", detail: "Install the Codex CLI to use it here.", version: null };
    const label = version.stdout.trim().split(/\s/).at(-1) || null;
    /* `codex login status` reports on stderr. */
    return login?.code === 0 && /logged in/i.test(login.stdout + login.stderr)
      ? { status: "ready", detail: "Signed in", version: label }
      : { status: "needs-auth", detail: "Run `codex login` in a terminal.", version: label };
  },
  run,
};
