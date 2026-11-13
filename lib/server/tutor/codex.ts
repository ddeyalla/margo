import { cliPrompt } from "./prompt";
import { lastErrorLine, parseJsonLine, runQuiet, scratchDir, streamCli } from "./process";
import type { Provider, TutorEvent, TutorTurn } from "./types";

/**
 * The model when settings name none. The CLI's own default may be one a
 * ChatGPT sign-in can't use, which fails every turn.
 */
export const CODEX_DEFAULT_MODEL = "gpt-6-luna";

/**
 * A read-only run in an empty folder. Codex has no system-prompt flag, so a new
 * thread's prompt starts with the tutor instructions. `exec resume` takes no
 * -s or -C, so the sandbox goes through -c and the folder through the spawn cwd.
 * `--` keeps a message that starts with "-" from reading as a flag.
 */
export const codexArgs = (turn: TutorTurn, cwd: string): string[] => {
  const model = turn.model ?? CODEX_DEFAULT_MODEL;
  if (turn.sessionId) {
    return ["exec", "resume", "--json", "--skip-git-repo-check", "-c", 'sandbox_mode="read-only"', "-m", model, "--", turn.sessionId, cliPrompt(turn)];
  }
  const prompt = `${turn.system}\n\n---\n\n${cliPrompt(turn)}`;
  return ["exec", "--json", "--skip-git-repo-check", "-s", "read-only", "-C", cwd, "-m", model, "--", prompt];
};

/**
 * A parser for one run of `codex exec --json`. Answers arrive as whole
 * `agent_message` items, so items after the first are set apart as paragraphs.
 * Top-level `error` lines are skipped: they repeat the turn.failed message or
 * report a reconnect that may still succeed. Items of type "error" are warnings.
 */
export const createCodexParser = () => {
  let sawText = false;
  return (line: string): TutorEvent[] => {
    const event = parseJsonLine(line);
    if (!event) return [];
    if (event.type === "thread.started" && typeof event.thread_id === "string") {
      return [{ type: "session", id: event.thread_id }];
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
  for await (const event of streamCli({
    command: "codex",
    args: codexArgs(turn, cwd),
    cwd,
    signal,
    parseLine: createCodexParser(),
    describeExit: (code, stderr) => lastErrorLine(stderr) ?? `Codex exited with code ${code}.`,
  })) {
    if (event.type === "error" && turn.sessionId && LOST_SESSION.test(event.message)) {
      lostSession = true;
      break;
    }
    yield event;
  }
  if (lostSession) yield* run({ ...turn, sessionId: null }, signal);
}

export const codex: Provider = {
  id: "codex",
  label: "Codex",
  async probe() {
    const version = await runQuiet("codex", ["--version"]);
    if (!version) return { status: "missing", detail: "Install the Codex CLI to use it here.", version: null };
    const label = version.stdout.trim().split(/\s/).at(-1) || null;
    const login = await runQuiet("codex", ["login", "status"]);
    /* `codex login status` reports on stderr. */
    return login?.code === 0 && /logged in/i.test(login.stdout + login.stderr)
      ? { status: "ready", detail: "Signed in", version: label }
      : { status: "needs-auth", detail: "Run `codex login` in a terminal.", version: label };
  },
  run,
};
