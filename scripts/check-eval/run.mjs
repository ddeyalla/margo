// Runs the real model over the fixed evaluation set in tests/eval/ and prints how often it agrees with the labels.
// Usage: node scripts/check-eval/run.mjs <model> [provider] [verify|grade]
//   node scripts/check-eval/run.mjs claude-haiku-5-5
// The provider is "claude" (the Claude Code CLI, the default), "codex" or "api". Not part of `npm test`: it costs
// real model calls, about 90 for the whole set.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "../../node_modules/jiti/lib/jiti.mjs";

const repo = path.resolve(import.meta.dirname, "../..");
const [model, providerId = "claude", only] = process.argv.slice(2);
if (!model) {
  console.error("Usage: node scripts/check-eval/run.mjs <model> [claude|codex|api] [verify|grade]");
  process.exit(2);
}
// The providers keep scratch folders under the data folder; the evaluation touches no reader data.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "check-eval-"));

const jiti = createJiti(import.meta.url, { alias: { "@": repo } });
const load = (file) => jiti.import(path.join(repo, file));
const [{ verifyItem, isVerified }, { gradeAnswer }, { PROVIDERS }, { pooled }] = await Promise.all([
  load("lib/server/check/verify.ts"),
  load("lib/server/check/grade.ts"),
  load("lib/server/tutor/providers.ts"),
  load("lib/server/tutor/structured.ts"),
]);
const provider = PROVIDERS[providerId];
const read = (name) => JSON.parse(fs.readFileSync(path.join(repo, "tests/eval", name), "utf8"));
const signal = new AbortController().signal;

/** Runs one item and times it. An error is a result, not a crash: it counts as a miss. */
const timed = async (work) => {
  const started = Date.now();
  try {
    return { value: await work(), ms: Date.now() - started };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), ms: Date.now() - started };
  }
};
const median = (times) => [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

const runVerify = async () => {
  const items = read("verify-items.json");
  const results = await pooled(items, 4, (item) => timed(() => verifyItem(provider, item, model, signal)));
  let agree = 0;
  let wrongAccepted = 0;
  let goodRejected = 0;
  console.log(`\nVerification, ${items.length} items, ${providerId} ${model}`);
  items.forEach((item, i) => {
    const { value, error, ms } = results[i];
    const got = value ? isVerified(value) : false;
    const ok = !error && got === item.verified;
    if (ok) agree++;
    else if (item.verified) goodRejected++;
    else if (got) wrongAccepted++;
    const detail = error ? `ERROR ${error}` : `answerable=${value.answerable} matches=${value.matches} supported=${value.supported} · ${value.reason}`;
    console.log(`${ok ? "  ok " : " MISS"} ${item.id} want ${item.verified ? "verified" : "rejected"}, got ${error ? "error" : got ? "verified" : "rejected"} (${seconds(ms)}) ${detail}`);
  });
  console.log(`Agreement ${agree}/${items.length} · wrong items accepted ${wrongAccepted} · good items rejected ${goodRejected} · median ${seconds(median(results.map((r) => r.ms)))} per item`);
};

/** A clear answer must get its verdict and not be hedged; a middling one must be reported as unsure, whatever the verdict. */
const gradeAgrees = (label, grade) => (label === "middling" ? grade.unsure : grade.verdict === label && !grade.unsure);

const runGrade = async () => {
  const items = read("grade-answers.json");
  const results = await pooled(items, 4, ({ question, expected, passage, answer }) => timed(() => gradeAnswer(provider, { question, expected, passage, answer }, model, signal)));
  let agree = 0;
  let flipped = 0;
  console.log(`\nGrading, ${items.length} answers, ${providerId} ${model}`);
  items.forEach((item, i) => {
    const { value, error, ms } = results[i];
    const ok = !error && gradeAgrees(item.label, value);
    if (ok) agree++;
    if (value && !value.unsure && ((item.label === "right" && value.verdict === "wrong") || (item.label === "wrong" && value.verdict === "right"))) flipped++;
    const detail = error ? `ERROR ${error}` : `${value.verdict} score=${value.score} confidence=${value.confidence} unsure=${value.unsure} marks=${value.marks.join(",")}${value.gap ? ` · ${value.gap.note}` : ""}`;
    console.log(`${ok ? "  ok " : " MISS"} ${item.id} ${item.label.padEnd(8)} (${seconds(ms)}) ${detail}`);
  });
  const part = (keep) => `${items.filter((item, i) => keep(item) && results[i].value && gradeAgrees(item.label, results[i].value)).length}/${items.filter(keep).length}`;
  const by = (label) => `${items.filter((item, i) => item.label === label && results[i].value && gradeAgrees(label, results[i].value)).length}/${items.filter((item) => item.label === label).length}`;
  console.log(`Agreement ${agree}/${items.length} · right ${by("right")} · wrong ${by("wrong")} · middling reported unsure ${by("middling")} · confident flips ${flipped} · first 16 (prompts were tuned on these) ${part((item) => !item.heldOut)} · held out ${part((item) => item.heldOut)} · median ${seconds(median(results.map((r) => r.ms)))} per answer`);
};

if (only !== "grade") await runVerify();
if (only !== "verify") await runGrade();
process.exit(0);
