import { execFile, spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { TutorEvent } from "./types";

/**
 * A CLI child gets only these variables, never the server's whole environment.
 * HOME stays real so each CLI finds its own sign-in. API keys are left out on
 * purpose: with one set, a CLI would bill the key instead of the user's plan.
 */
const ENV_KEYS = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TZ", "TMPDIR",
  "CLAUDE_CONFIG_DIR", "CODEX_HOME",
]);
const ENV_PREFIXES = ["ANTHROPIC_", "OPENAI_"];
const ENV_BLOCKED = new Set(["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);

export const childEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { NO_COLOR: "1", FORCE_COLOR: "0", NODE_ENV: process.env.NODE_ENV };
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || ENV_BLOCKED.has(key)) continue;
    if (ENV_KEYS.has(key) || ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) env[key] = value;
  }
  return env;
};

/** A stable scratch folder per provider, outside the project and the books folder. CLIs key sessions by folder. */
export const scratchDir = async (provider: string): Promise<string> => {
  const dir = path.join(tmpdir(), "rigg-learn-tutor", provider);
  await mkdir(dir, { recursive: true });
  return dir;
};

/** Runs a short command and returns its output, or null if it is missing or hangs. */
export const runQuiet = (command: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number } | null> =>
  new Promise((resolve) => {
    execFile(command, args, { env: childEnv(), timeout: 10_000, cwd: tmpdir() }, (error, stdout, stderr) => {
      if (error && ((error as NodeJS.ErrnoException).code === "ENOENT" || error.killed)) return resolve(null);
      const code = typeof error?.code === "number" ? error.code : 0;
      resolve({ stdout: String(stdout), stderr: String(stderr), code });
    });
  });

const KILL_GRACE_MS = 2000;

interface StreamOptions {
  command: string;
  args: string[];
  cwd: string;
  signal: AbortSignal;
  /**
   * Written to the child's stdin, which then closes. Without it stdin is never
   * opened: codex would read a piped stdin as more of its prompt.
   */
  input?: string;
  parseLine(line: string): TutorEvent[];
  /** Turns a failed exit with no error event into a message. */
  describeExit(code: number | null, stderr: string): string;
}

/** Spawns a CLI and yields events parsed from its stdout lines. The child dies on abort or when the caller stops reading. */
export async function* streamCli({ command, args, cwd, signal, input, parseLine, describeExit }: StreamOptions): AsyncGenerator<TutorEvent> {
  if (signal.aborted) return;
  const options = { cwd, env: childEnv() };
  const child =
    input === undefined
      ? spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] })
      : spawn(command, args, { ...options, stdio: "pipe" });
  if (input !== undefined && child.stdin) {
    /* A child that exits before reading everything breaks the pipe; its exit reports why. */
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  }
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-8000);
  });
  let spawnError: NodeJS.ErrnoException | null = null;
  const exited = new Promise<number | null>((resolve) => {
    child.once("error", (error) => {
      spawnError = error;
      resolve(null);
    });
    child.once("close", (code) => resolve(code));
  });
  const kill = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, KILL_GRACE_MS).unref();
  };
  signal.addEventListener("abort", kill, { once: true });

  try {
    let sawError = false;
    for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
      for (const event of parseLine(line)) {
        if (event.type === "error") sawError = true;
        yield event;
      }
    }
    const code = await exited;
    if (signal.aborted || sawError) return;
    if (spawnError) {
      yield { type: "error", message: (spawnError as NodeJS.ErrnoException).code === "ENOENT" ? `${command} is not installed.` : String(spawnError) };
    } else if (code !== 0) {
      yield { type: "error", message: describeExit(code, stderr) };
    }
  } finally {
    signal.removeEventListener("abort", kill);
    kill();
  }
}

/** The most useful line of a CLI's stderr: its last "Error:" line, else its last line. */
export const lastErrorLine = (stderr: string): string | null => {
  const lines = stderr.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.findLast((line) => /^error[:\s]/i.test(line)) ?? lines.at(-1) ?? null;
};

export const parseJsonLine = (line: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
