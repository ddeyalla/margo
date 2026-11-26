import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { callTool, TOOLS } from "../tools";
import { jsonSchema } from "../tools/schema";

/*
 * The tool registry over the Model Context Protocol, for Claude Code, Codex and any other agent that speaks it.
 * The transport is stdio: one JSON-RPC 2.0 message per line in, one per line out. The server only needs tools,
 * so it answers `initialize`, `ping`, `tools/list` and `tools/call` and nothing else, in a file short enough
 * to read, in place of the protocol's SDK and what that would bring into the app.
 */

/** The protocol versions this server can speak, newest first. A client asking for another gets the newest. */
const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export const SERVER_NAME = "rigg-learn";

const INSTRUCTIONS = `The reader's own library in rigg learn: their books, highlights, notes, review cards, tutor conversations, Courses and whiteboards, on this machine.
Start with list_library for book ids. search_library and get_book_text give passages with anchors; quote the book from them, not from memory.
You may read anything. You may write two things directly: park_question and log_activity. Any other change is proposed with propose_card and waits for the reader to accept it in the app.
propose_card checks each card against the quote you give and leaves out the ones that fail, with why. Check any other question you write with verify_item before you show it to the reader. grade_answer grades a free-text answer; when it says "unsure", show the gap and let the reader decide.`;

type Id = string | number | null;

interface Message {
  jsonrpc?: unknown;
  id?: Id;
  method?: unknown;
  params?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

/** One connection's state: who the client said it is, which names the calls in the tool log. */
interface Session {
  caller: string;
}

const handle = async (method: string, params: unknown, session: Session): Promise<unknown> => {
  const args = isRecord(params) ? params : {};
  switch (method) {
    case "initialize": {
      const client = isRecord(args.clientInfo) && typeof args.clientInfo.name === "string" ? args.clientInfo.name.trim().slice(0, 80) : "";
      if (client) session.caller = client;
      const asked = typeof args.protocolVersion === "string" ? args.protocolVersion : "";
      return {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: "0.1.0" },
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return {
        tools: TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: jsonSchema(tool.input),
          annotations: { readOnlyHint: tool.effect === "read", destructiveHint: false, openWorldHint: false },
        })),
      };
    case "tools/call": {
      if (typeof args.name !== "string") throw new RpcError(-32602, "tools/call needs the tool's name.");
      const result = await callTool(args.name, args.arguments, session.caller);
      return result.ok
        ? { content: [{ type: "text", text: JSON.stringify(result.value) }] }
        : { content: [{ type: "text", text: result.error }], isError: true };
    }
    default:
      throw new RpcError(-32601, `Method not found: ${method}`);
  }
};

/**
 * Serves the registry on a pair of streams until the input ends. Requests are answered as they finish, so a slow
 * search doesn't hold up a quick read. Returns once every answer has been written.
 */
export const serve = async (input: Readable, output: Writable): Promise<void> => {
  const session: Session = { caller: "agent" };
  const send = (message: Record<string, unknown>) => output.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const running = new Set<Promise<void>>();

  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    let message: Message;
    try {
      message = JSON.parse(line) as Message;
    } catch {
      send({ id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    const { id, method } = isRecord(message) ? message : ({} as Message);
    if (typeof method !== "string") {
      /* A reply to something this server never asks is ignored; anything else is not a request. */
      if (!isRecord(message)) send({ id: null, error: { code: -32600, message: "Invalid request" } });
      continue;
    }
    /* A message with no id is a notification, such as "notifications/initialized": nothing is answered. */
    if (id === undefined) continue;
    const task = handle(method, message.params, session)
      .then(
        (result) => void send({ id, result }),
        (error: unknown) => {
          const known = error instanceof RpcError;
          if (!known) console.error(`${method} failed:`, error);
          send({ id, error: { code: known ? error.code : -32603, message: error instanceof Error ? error.message : "Internal error" } });
        },
      )
      .finally(() => running.delete(task));
    running.add(task);
    /* The handshake is answered before anything after it is read, so the caller's name is set for the calls that follow. */
    if (method === "initialize") await task;
  }
  await Promise.all(running);
  /* Writes to a pipe can still be on their way; a caller that exits next would cut the last answers off. */
  await new Promise<void>((flushed) => output.write("", () => flushed()));
};
