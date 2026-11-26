import { gradeAnswerTool } from "./grade";
import { queryLedger } from "./ledger-query";
import { recordEvidenceTool } from "./ledger-record";
import { weakestItems } from "./ledger-weakest";
import { logToolCall, summarizeArgs } from "./log";
import { READ_TOOLS } from "./read";
import { ToolError, type Fields } from "./schema";
import { SUGGESTION_TOOLS } from "./suggest";
import { runTool, type Tool } from "./tool";
import { verifyItemTool } from "./verify";
import { WRITE_TOOLS } from "./write";

/**
 * Everything the app can do for an agent, by name. An agent reads, writes the few things that are safe to write
 * directly (a parked question, learning time, an event in the learner ledger), and proposes the rest as suggestions
 * the reader accepts. Nothing here searches the web. Two tools ask a model and change nothing: one checks a written
 * question against its passage, one grades a free-text answer.
 */
export const TOOLS: readonly Tool<Fields>[] = [...READ_TOOLS, ...WRITE_TOOLS, ...SUGGESTION_TOOLS, verifyItemTool, gradeAnswerTool, queryLedger, weakestItems, recordEvidenceTool] as unknown as Tool<Fields>[];

export type ToolResult = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Calls a tool by name for an outside caller and writes the call to the log, whatever came of it. A bad name or
 * bad arguments answer with what was wrong; an error inside the tool answers with its message and is also printed.
 */
export const callTool = async (name: string, args: unknown, caller: string): Promise<ToolResult> => {
  const started = Date.now();
  const tool = TOOLS.find((entry) => entry.name === name);
  let result: ToolResult;
  let outcome: "ok" | "refused" | "failed" = "ok";
  try {
    if (!tool) throw new ToolError(`There is no tool called "${name}".`);
    result = { ok: true, value: await runTool(tool, args, { caller, now: new Date() }) };
  } catch (error) {
    outcome = error instanceof ToolError ? "refused" : "failed";
    if (outcome === "failed") console.error(`Tool ${name} failed:`, error);
    result = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  await logToolCall({
    at: new Date().toISOString(),
    tool: name,
    caller,
    args: summarizeArgs(args),
    outcome,
    ...(result.ok ? {} : { error: result.error }),
    ms: Date.now() - started,
  }).catch((error: unknown) => console.error("Could not write the tool log:", error));
  return result;
};
