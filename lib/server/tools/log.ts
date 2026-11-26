import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config";

/** One tool call, as kept in the log. */
export interface ToolCall {
  /** When the call finished, an ISO time. */
  at: string;
  tool: string;
  /** "app" for the app's own routes, otherwise the name the agent's client gave. */
  caller: string;
  /** The arguments with long text cut short: enough to see what was asked, not a copy of it. */
  args: string;
  outcome: "ok" | "refused" | "failed";
  /** Why, for a call that was refused or failed. */
  error?: string;
  ms: number;
}

/** Every tool call, one JSON object per line, oldest first. Lines are only ever added. */
export const toolLogFile = (dataDir = getConfig().dataDir) => path.join(/*turbopackIgnore: true*/ dataDir, "tool-log.jsonl");

const MAX_TEXT = 120;
const MAX_ARGS = 1_000;

const shortened = (value: unknown): unknown => {
  if (typeof value === "string") return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}… (${value.length} characters)` : value;
  if (Array.isArray(value)) return value.slice(0, 5).map(shortened);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, shortened(entry)]));
  return value;
};

/** The arguments as one short line of JSON. */
export const summarizeArgs = (args: unknown): string => (JSON.stringify(shortened(args ?? {})) ?? "{}").slice(0, MAX_ARGS);

/**
 * Adds one line to the log. A line goes down in a single append, which the system keeps whole even when the
 * app and an agent's server write at once, so the file needs no lock.
 */
export const logToolCall = async (call: ToolCall, dataDir = getConfig().dataDir): Promise<void> => {
  const file = toolLogFile(dataDir);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(call)}\n`);
};

/** The log's calls, oldest first. A line that isn't JSON, such as one cut off by a crash, is skipped. */
export const readToolLog = async (dataDir = getConfig().dataDir): Promise<ToolCall[]> => {
  const text = await readFile(toolLogFile(dataDir), "utf8").catch(() => "");
  return text.split("\n").flatMap((line) => {
    try {
      return line ? [JSON.parse(line) as ToolCall] : [];
    } catch {
      return [];
    }
  });
};
