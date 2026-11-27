import Anthropic from "@anthropic-ai/sdk";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { getConfig } from "./config";
import { apiKey } from "./tutor/api";
import { parseClaudeLine } from "./tutor/claude";
import { childEnv, scratchDir } from "./tutor/process";

/* The hover glance (a spike, see docs/plans/margo-rd-plan.md). With ANTHROPIC_API_KEY set, each glance is one
   streamed Haiku call to the API: the first words come in about 0.7 s. Without a key, one claude CLI process
   with Haiku stays running and each glance is one more message to it (about 2 s, since the CLI adds its own
   time to each turn). Either way the answer streams as plain text, and each book keeps the answers it has had,
   so a word glanced at again shows at once. */

export const GLANCE_SYSTEM = `You explain one word or term from a book to its reader, in the sentence they found it in.
Each message gives the book, the sentence and the term. Answer each message on its own, in exactly three lines:
1. What the term means here, in one or two plain sentences, at most 40 words. No label, no quotes.
2. "Example: " and one short concrete example, at most 25 words.
3. "Kind: core" when the sentence is teaching this idea, or "Kind: background" when the term is background the reader needs to follow it.`;

/** The worker restarts after this many glances, so its conversation never grows long and slow. */
export const TURNS_PER_WORKER = 20;
/** And after this long unused, giving back its memory. */
const IDLE_MS = 10 * 60_000;

export const GLANCE_API_MODEL = "claude-haiku-5-5";

export interface GlanceAsk {
  bookId: string;
  book: string;
  term: string;
  sentence: string;
}

/** One answer being written: its text so far, and every listener waiting for more. */
interface Job {
  ask: GlanceAsk;
  text: string;
  done: boolean;
  error: string | null;
  listeners: Set<() => void>;
  started: number;
  firstText: number | null;
  /** The warm-up message: the CLI finishes starting only once it gets a first message. Not saved. */
  prime?: boolean;
}

interface Worker {
  child: ChildProcessWithoutNullStreams;
  turns: number;
  current: Job | null;
  queue: Job[];
}

interface GlanceState {
  worker: Worker | null;
  idle: ReturnType<typeof setTimeout> | null;
  /** Answers by book, then by lowercase term, loaded from disk on first use. */
  cache: Map<string, Map<string, string>>;
}

const state: GlanceState = ((globalThis as { __margoGlance?: GlanceState }).__margoGlance ??= { worker: null, idle: null, cache: new Map() });

const cacheFile = (bookId: string) => path.join(/*turbopackIgnore: true*/ getConfig().dataDir, "glances", `${bookId}.json`);

const cacheOf = async (bookId: string) => {
  let book = state.cache.get(bookId);
  if (!book) {
    book = new Map();
    try {
      for (const [term, text] of Object.entries(JSON.parse(await readFile(cacheFile(bookId), "utf8")) as Record<string, string>)) book.set(term, text);
    } catch {
      /* No answers saved yet. */
    }
    state.cache.set(bookId, book);
  }
  return book;
};

const remember = async (bookId: string, term: string, text: string) => {
  const book = await cacheOf(bookId);
  book.set(term.toLowerCase(), text);
  await mkdir(path.dirname(cacheFile(bookId)), { recursive: true });
  await writeFile(cacheFile(bookId), JSON.stringify(Object.fromEntries(book)));
};

/** A saved answer for this word in this book, or null. */
export const cachedGlance = async (bookId: string, term: string) => (await cacheOf(bookId)).get(term.toLowerCase()) ?? null;

const notify = (job: Job) => {
  for (const listener of job.listeners) listener();
};

const finish = (worker: Worker, error: string | null) => {
  const job = worker.current;
  worker.current = null;
  if (job) {
    job.done = true;
    job.error = error ?? (job.text.trim() ? null : "The glance came back empty.");
    if (!job.error && !job.prime) void remember(job.ask.bookId, job.ask.term, job.text.trim()).catch(() => {});
    notify(job);
  }
  next(worker);
};

const askText = ({ book, sentence, term }: GlanceAsk) => `Book: ${book}\nSentence: ${sentence}\nTerm: ${term}`;

const send = (worker: Worker, job: Job) => {
  worker.current = job;
  worker.turns += 1;
  const content = [{ type: "text", text: askText(job.ask) }];
  worker.child.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`);
};

const next = (worker: Worker) => {
  if (worker.current) return;
  if (worker !== state.worker) {
    /* Retired: answer what it still holds, then go. */
    if (!worker.queue.length) worker.child.stdin.end();
  }
  const job = worker.queue.shift();
  if (job) send(worker, job);
  else scheduleStop();
};

const startWorker = async (): Promise<Worker> => {
  const child = spawn(
    "claude",
    ["--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--safe-mode", "--strict-mcp-config", "--system-prompt", GLANCE_SYSTEM, "--model", "haiku", "--tools", ""],
    { cwd: await scratchDir("glance"), env: childEnv(), stdio: ["pipe", "pipe", "pipe"] },
  );
  const worker: Worker = { child, turns: 0, current: null, queue: [] };
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-2000)));
  createInterface({ input: child.stdout }).on("line", (line) => {
    const job = worker.current;
    if (!job) return;
    if (line.includes('"type":"result"')) {
      const failed = parseClaudeLine(line).find((event) => event.type === "error");
      return finish(worker, failed?.type === "error" ? failed.message : null);
    }
    for (const event of parseClaudeLine(line)) {
      if (event.type !== "text") continue;
      job.firstText ??= Date.now();
      job.text += event.delta;
      notify(job);
    }
  });
  const gone = () => {
    if (state.worker === worker) state.worker = null;
    const error = stderr.trim().split("\n").at(-1) || "Claude Code stopped.";
    for (const job of [worker.current, ...worker.queue]) {
      if (!job || job.done) continue;
      job.done = true;
      job.error = error;
      notify(job);
    }
    worker.current = null;
    worker.queue = [];
  };
  child.on("exit", gone);
  child.on("error", gone);
  return worker;
};

const scheduleStop = () => {
  clearTimeout(state.idle ?? undefined);
  state.idle = setTimeout(() => {
    const worker = state.worker;
    if (!worker || worker.current || worker.queue.length) return;
    state.worker = null;
    worker.child.stdin.end();
  }, IDLE_MS);
  state.idle.unref?.();
};

let starting: Promise<Worker> | null = null;

/** The running worker, started if needed, and replaced once it has answered TURNS_PER_WORKER glances. */
const worker = async () => {
  const running = state.worker;
  if (running && running.turns < TURNS_PER_WORKER) return running;
  starting ??= startWorker().finally(() => (starting = null));
  const fresh = await starting;
  if (state.worker !== fresh) {
    const old = state.worker;
    state.worker = fresh;
    /* The old one answers what it holds, then stops. */
    if (old) next(old);
  }
  return fresh;
};

/**
 * Starts the worker ahead of the first glance, so that one does not wait for the CLI to start. The CLI does most
 * of its starting when its first message arrives, so a short warm-up message goes too (one small Haiku call).
 */
export const warmGlance = async () => {
  if (apiKey()) return;
  const running = await worker();
  if (running.turns === 0 && !running.current && !running.queue.length) {
    running.queue.push({ ask: { bookId: "", book: "-", term: "ready", sentence: "Say ready." }, text: "", done: false, error: null, listeners: new Set(), started: Date.now(), firstText: null, prime: true });
    next(running);
  }
};

/**
 * Streams the answer for one glance: each call of `onText` gets the whole text so far. A newer glance drops any
 * that are still waiting, since the reader has moved on; the one being written finishes and is saved.
 */
export interface GlanceDone {
  text: string;
  firstMs: number | null;
  totalMs: number;
  via: "api" | "cli";
}

/** One glance as one streamed API call. Low effort: a glance needs speed, not deep thought. */
const glanceByApi = async (key: string, ask: GlanceAsk, onText: (text: string) => void, signal: AbortSignal): Promise<GlanceDone> => {
  const started = Date.now();
  let first: number | null = null;
  let text = "";
  const stream = new Anthropic({ apiKey: key }).messages.stream(
    { model: GLANCE_API_MODEL, max_tokens: 400, output_config: { effort: "low" }, system: GLANCE_SYSTEM, messages: [{ role: "user", content: askText(ask) }] },
    { signal },
  );
  for await (const event of stream) {
    if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") continue;
    first ??= Date.now() - started;
    text += event.delta.text;
    onText(text);
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") throw new Error("The model declined this glance.");
  if (!text.trim()) throw new Error("The glance came back empty.");
  void remember(ask.bookId, ask.term, text.trim()).catch(() => {});
  return { text: text.trim(), firstMs: first, totalMs: Date.now() - started, via: "api" };
};

export const glance = async (ask: GlanceAsk, onText: (text: string) => void, signal: AbortSignal): Promise<GlanceDone> => {
  const key = apiKey();
  if (key) return glanceByApi(key, ask, onText, signal);
  clearTimeout(state.idle ?? undefined);
  const running = await worker();
  for (const waiting of running.queue.splice(0).filter((job) => !job.prime)) {
    waiting.done = true;
    waiting.error = "Replaced by a newer glance.";
    notify(waiting);
  }
  const job: Job = { ask, text: "", done: false, error: null, listeners: new Set(), started: Date.now(), firstText: null };
  running.queue.push(job);
  next(running);
  return new Promise((resolve, reject) => {
    const listener = () => {
      if (job.text) onText(job.text);
      if (!job.done) return;
      job.listeners.delete(listener);
      if (job.error) reject(new Error(job.error));
      else resolve({ text: job.text.trim(), firstMs: job.firstText && job.firstText - job.started, totalMs: Date.now() - job.started, via: "cli" });
    };
    job.listeners.add(listener);
    signal.addEventListener("abort", () => job.listeners.delete(listener), { once: true });
  });
};
