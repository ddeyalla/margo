// Runs the "Work it out" tutor on every passage through the Claude Code CLI, the way the
// app does (real prompt code, no tools, empty folder, no session), then has a judge score it.
// Usage: node scripts/work-eval/run.mjs <dir with passages.json> <tutor model> [judge model] [tag]
// Writes <dir>/results-<tag, or the tutor model>.json with every transcript and the judge's verdict.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "../../node_modules/jiti/lib/jiti.mjs";

const repo = path.resolve(import.meta.dirname, "../..");
const dir = process.argv[2];
const model = process.argv[3];
const judgeModel = process.argv[4] ?? "claude-opus-5-5";
const tag = process.argv[5] ?? model;
const jiti = createJiti(import.meta.url, { alias: { "@": repo }, moduleCache: false });
const { buildTurn, cliInput, TUTOR_SYSTEM } = await jiti.import(path.join(repo, "lib/server/tutor/prompt.ts"));
const passages = JSON.parse(fs.readFileSync(path.join(dir, "passages.json"), "utf8"));
const empty = fs.mkdtempSync(path.join(os.tmpdir(), "work-eval-"));

const claude = (system, prompt, m) =>
  new Promise((resolve, reject) => {
    const args = ["--print", "--output-format", "json", "--safe-mode", "--strict-mcp-config", "--tools", "", "--system-prompt", system, "--model", m];
    const child = spawn("claude", args, { cwd: empty, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", () => {
      try {
        const e = JSON.parse(out);
        if (e.is_error || typeof e.result !== "string" || !e.result.trim()) throw new Error(`empty or error result ${String(e.result).slice(0, 200)}`);
        resolve(e.result);
      } catch (x) {
        reject(new Error(`${x.message} ${err.slice(0, 300)}`));
      }
    });
    child.stdin.end(prompt);
  });
const retry = async (fn) => {
  try { return await fn(); } catch { return await fn(); }
};

const now = new Date().toISOString();
const msg = (role, content) => ({ role, content, createdAt: now });
const tutorReply = (p, messages) => {
  const thread = {
    id: "eval", provider: "claude", sessionId: null, createdAt: now, messages,
    kind: "passage", anchor: { kind: "epub", cfi: "x" }, quote: p.quote, before: p.before ?? "", after: p.after ?? "",
    chapterTitle: p.chapter ?? null, action: "work",
  };
  const turn = buildTurn({ title: p.book, author: null }, thread, model, new Map());
  return retry(() => claude(TUTOR_SYSTEM, cliInput(turn).text, model));
};

const READER = `You are role-playing a reader who is working through a book with a tutor. Reply only with the reader's message, nothing else.`;
const readerPrompt = (p, question) =>
  `You have just read this passage:\n<passage>\n${p.quote}\n</passage>\n\nThe tutor said:\n<tutor>\n${question}\n</tutor>\n\nAnswer the tutor's question in 1-2 casual sentences. Your answer is partly right but contains one real misconception. Use one distinctive phrase of your own in it.`;

const JUDGE = `You judge a tutor that leads a reader to an answer instead of giving it. Reply with one JSON object only, no other text, with exactly these keys, each {"pass": boolean, "reason": "one line"}:
- oneQuestion: every tutor turn asks exactly one question (a sentence that joins two asks with "and" or "or" counts as two; zero questions also fails).
- noEarlyAnswer: no tutor turn states the answer to what is being worked out, or states the correction to the reader's mistake.
- ownWords: tutor turn 2 nudges at the reader's first mistake and reuses the reader's own wording (quoting or echoing a phrase from the reader's reply).
- hintStep: tutor turn 3 (the reply to "Hint 1") only points back to the part of the passage (or the text around it that the tutor was given) to re-read, and does not name the idea or answer it.`;
const transcriptText = (t) => t.map((m, i) => `${m.role === "user" ? "READER" : "TUTOR"}${m.role === "user" ? "" : ` (turn ${(i + 1) / 2})`}:\n${m.content}`).join("\n\n");
const parseJson = (s) => {
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  const j = JSON.parse(s.slice(a, b + 1));
  for (const k of ["oneQuestion", "noEarlyAnswer", "ownWords", "hintStep"]) if (typeof j[k]?.pass !== "boolean") throw new Error(`bad judge key ${k}`);
  return j;
};

const one = async (p) => {
  const r = { id: p.id, book: p.book, quote: p.quote, transcript: [], judge: null, error: null };
  try {
    const t = [msg("user", "Help me work this out.")];
    t.push(msg("assistant", await tutorReply(p, t)));
    const reader = (await retry(() => claude(READER, readerPrompt(p, t[1].content), model))).trim();
    t.push(msg("user", reader));
    t.push(msg("assistant", await tutorReply(p, t)));
    t.push(msg("user", "Hint 1"));
    t.push(msg("assistant", await tutorReply(p, t)));
    r.transcript = t.map(({ role, content }) => ({ role, content }));
    const prompt = `The tutor also saw the text around the passage, so quoting or pointing at it is not going outside the passage.\n<before>\n${p.before || "(none)"}\n</before>\n\n<passage>\n${p.quote}\n</passage>\n\n<after>\n${p.after || "(none)"}\n</after>\n\n<transcript>\n${transcriptText(r.transcript)}\n</transcript>`;
    r.questionMarks = r.transcript.filter((m) => m.role === "assistant").map((m) => (m.content.match(/\?/g) ?? []).length);
    r.judge = await retry(async () => parseJson(await claude(JUDGE, prompt, judgeModel)));
  } catch (e) {
    r.error = e.message;
  }
  return r;
};

const results = [];
const queue = [...passages];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const p = queue.shift();
      const r = await one(p);
      results.push(r);
      console.log(p.id, r.error ? `ERROR ${r.error}` : `marks=${r.questionMarks.join(",")} ` + Object.entries(r.judge).map(([k, v]) => `${k}=${v.pass ? 1 : 0}`).join(" "));
    }
  }),
);
results.sort((a, b) => a.id - b.id);
const keys = ["oneQuestion", "noEarlyAnswer", "ownWords", "hintStep"];
const ok = results.filter((r) => r.judge);
// "One question" is gated on the mechanical count (exactly one "?" in every tutor turn); the judge's verdict is reported beside it.
const oneMark = ok.filter((r) => r.questionMarks.every((n) => n === 1)).length;
const summary = { oneQuestion: oneMark, judgeOneQuestion: ok.filter((r) => r.judge.oneQuestion.pass).length };
for (const k of keys.slice(1)) summary[k] = ok.filter((r) => r.judge[k].pass).length;
fs.writeFileSync(path.join(dir, `results-${tag}.json`), JSON.stringify({ model, judgeModel, summary, failed: results.length - ok.length, results }, null, 2));
console.log("one question (mechanical, gate):", oneMark, "/", ok.length, "| judge's verdict:", summary.judgeOneQuestion);
console.log(summary, "failed:", results.length - ok.length);
