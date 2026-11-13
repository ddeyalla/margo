// Runs the card prompt on every passage through the Claude Code CLI, the way the
// tutor does: no tools, an empty folder, one fixed model. Writes results.json.
// Usage: copy prompt.md next to passages.json, then: node run.mjs <that dir> <model>
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = process.argv[2];
const model = process.argv[3];
const system = fs.readFileSync(path.join(dir, "prompt.md"), "utf8");
const passages = JSON.parse(fs.readFileSync(path.join(dir, "passages.json"), "utf8"));
const empty = fs.mkdtempSync(path.join(os.tmpdir(), "card-eval-"));

const userMessage = (p) =>
  [
    `Book: ${p.book}`,
    p.chapter ? `Where: ${p.chapter}` : null,
    "",
    "Text just before the selection:",
    `<before>\n${p.before || "(start of the section)"}\n</before>`,
    "",
    "The selected passage:",
    `<selection>\n${p.quote}\n</selection>`,
    "",
    "Text just after the selection:",
    `<after>\n${p.after || "(end of the section)"}\n</after>`,
    "",
    "Make flashcards for this passage.",
  ]
    .filter((l) => l !== null)
    .join("\n");

const run = (p) =>
  new Promise((resolve) => {
    const args = ["--print", "--output-format", "json", "--safe-mode", "--strict-mcp-config", "--system-prompt", system, "--model", model, "--tools", ""];
    const child = spawn("claude", args, { cwd: empty, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", () => {
      let raw = null;
      let parsed = null;
      let error = null;
      try {
        const envelope = JSON.parse(out);
        raw = envelope.result;
        parsed = JSON.parse(raw);
      } catch (e) {
        error = `${e.message} ${err.slice(0, 300)}`;
      }
      resolve({ id: p.id, book: p.book, quote: p.quote, raw, parsed, error });
    });
    child.stdin.end(userMessage(p));
  });

const results = [];
const queue = [...passages];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const p = queue.shift();
      const r = await run(p);
      results.push(r);
      console.log(p.id, r.error ? `ERROR ${r.error}` : `${r.parsed.cards.length} cards`);
    }
  }),
);
results.sort((a, b) => a.id - b.id);
fs.writeFileSync(path.join(dir, `results-${model}.json`), JSON.stringify(results, null, 2));
