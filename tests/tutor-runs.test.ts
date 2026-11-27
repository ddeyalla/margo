import { existsSync } from "node:fs";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { claude } from "@/lib/server/tutor/claude";
import { codex } from "@/lib/server/tutor/codex";
import { scratchDir } from "@/lib/server/tutor/process";
import type { TutorTurn } from "@/lib/server/tutor/types";

/* Stand-ins for the CLIs, found first on PATH. Each answers with what it was given, as one text event. */
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const files = args.flatMap((arg, i) => (arg === "-i" ? [args[i + 1]] : []));
const answer = { files, bytes: files.map((f) => fs.readFileSync(f).toString("base64")), stdinPiped: fs.fstatSync(0).isFIFO() };
console.log(JSON.stringify({ type: "thread.started", thread_id: "fake" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(answer) } }));
`;

const FAKE_CLAUDE = `#!/usr/bin/env node
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const delta = { type: "content_block_delta", delta: { type: "text_delta", text: JSON.stringify({ input, args: process.argv.slice(2) }) } };
  console.log(JSON.stringify({ type: "stream_event", event: delta }));
});
`;

const answer = async (events: AsyncIterable<{ type: string; delta?: string; message?: string }>) => {
  let text = "";
  for await (const event of events) {
    if (event.type === "error") throw new Error(event.message);
    if (event.type === "text") text += event.delta;
  }
  return JSON.parse(text);
};

const turn: TutorTurn = {
  system: "Be a tutor.",
  messages: [
    {
      role: "user",
      content: "What are these?",
      images: [
        { mediaType: "image/png", data: Buffer.from("png bytes").toString("base64") },
        { mediaType: "image/webp", data: Buffer.from("webp bytes").toString("base64") },
      ],
    },
  ],
  sessionId: null,
  model: null,
};

describe("CLI runs with images", () => {
  let bin = "";
  beforeAll(async () => {
    bin = await mkdtemp(path.join(tmpdir(), "margo-fake-cli-"));
    for (const [name, script] of [["codex", FAKE_CODEX], ["claude", FAKE_CLAUDE]]) {
      await writeFile(path.join(bin, name), script);
      await chmod(path.join(bin, name), 0o755);
    }
  });
  afterEach(() => vi.unstubAllEnvs());

  it("hands codex each image as a file in its own folder in the scratch folder, then deletes the folder", async () => {
    vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH}`);
    const seen = await answer(codex.run(turn, new AbortController().signal));
    const scratch = await scratchDir("codex");
    expect(seen.files).toHaveLength(2);
    expect(seen.files.map((file: string) => path.dirname(path.dirname(file)))).toEqual([scratch, scratch]);
    expect(path.basename(path.dirname(seen.files[0]))).toMatch(/^images-/);
    expect(seen.files.map((file: string) => path.extname(file))).toEqual([".png", ".webp"]);
    expect(seen.bytes).toEqual(turn.messages[0].images.map((image) => image.data));
    expect(seen.stdinPiped).toBe(false);
    expect(existsSync(path.dirname(seen.files[0]))).toBe(false);
  });

  it("writes claude's message to its stdin as one stream-json line", async () => {
    vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH}`);
    const seen = await answer(claude.run(turn, new AbortController().signal));
    expect(seen.args).toContain("--input-format");
    const line = JSON.parse(seen.input);
    expect(line.message.content.map((block: { type: string }) => block.type)).toEqual(["image", "image", "text"]);
    expect(line.message.content[2].text).toBe("What are these?");
  });
});
