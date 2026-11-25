import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FocusBlocking, FocusStart } from "@/lib/shared/focus";
import { isObject } from "./validate";

/**
 * A focus session in the reader borrows Three, the focus app, for blocking: its `three` CLI starts a session on a
 * reading task, and Three's own blocker hides distracting apps and sites while it runs. Without Three the reader's
 * timer still runs; it just blocks nothing. Three's plan belongs to the person, so this never overrides a session
 * they started there, reuses one tagged task per book a day, and only stops a session it started.
 */

/** Runs `three` with these arguments and resolves its stdout; rejects with Three's own error line. */
export type ThreeRun = (args: string[]) => Promise<string>;

export const FOCUS_TAG = "rigg-learn";
const TITLE_LIMIT = 120;

/* A GUI app on macOS gets a minimal PATH, so the usual install places are tried by name. */
const candidates = () => [process.env.THREE_BIN, join(homedir(), ".local/bin/three"), "/opt/homebrew/bin/three", "/usr/local/bin/three"];

export async function findThree(): Promise<string | null> {
  for (const path of candidates()) {
    if (!path) continue;
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      /* Not here; try the next place. */
    }
  }
  return null;
}

const errorLine = (stderr: string, fallback: string) =>
  stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => line.startsWith("Error:"))
    ?.replace(/^Error:\s*/, "") || fallback;

export const threeRunner =
  (bin: string): ThreeRun =>
  (args) =>
    new Promise((resolve, reject) => {
      execFile(bin, args, { timeout: 15_000, env: process.env }, (error, stdout, stderr) => {
        if (error) reject(new Error(errorLine(String(stderr), error.message)));
        else resolve(String(stdout));
      });
    });

const json = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

interface Running {
  id: string;
  plannedEnd: string | null;
}

/** `three status --json`: the running session or break, or null. */
export const parseRunning = (text: string): Running | null => {
  const value = json(text);
  if (!isObject(value) || typeof value.id !== "string") return null;
  return { id: value.id, plannedEnd: typeof value.plannedEnd === "string" ? value.plannedEnd : null };
};

/** Today's open task for this book, the one this app tagged, from `three today --json`. */
export const findReadingTask = (text: string, title: string): string | null => {
  const value = json(text);
  const tasks = isObject(value) && Array.isArray(value.tasks) ? value.tasks : [];
  const task = tasks.find(
    (task) =>
      isObject(task) &&
      task.title === title &&
      task.status !== "done" &&
      task.status !== "dropped" &&
      Array.isArray(task.tags) &&
      task.tags.includes(FOCUS_TAG),
  );
  return isObject(task) && typeof task.id === "string" ? task.id : null;
};

/** `three block status --json`, as what a session would enforce. */
export const parseBlocking = (text: string): FocusBlocking => {
  const value = json(text);
  if (!isObject(value)) return { state: "off", reason: "Three’s block list couldn’t be read, so nothing is blocked." };
  const rules = Array.isArray(value.rules) ? value.rules.filter((rule) => isObject(rule) && rule.enabled !== false) : [];
  const count = (kind: string) => rules.filter((rule) => isObject(rule) && rule.kind === kind).length;
  const sites = count("domain");
  const apps = count("app");
  if (!sites && !apps) return { state: "off", reason: "Three’s block list is empty, so nothing is blocked. Add sites and apps in Three’s Settings → Blocking." };
  const chrome = isObject(value.chrome) ? value.chrome : {};
  const chromeConnected = typeof chrome.connectedProfiles === "number" && chrome.connectedProfiles > 0;
  return { state: "on", sites, apps, chromeConnected };
};

const off = (reason: string): FocusStart => ({ sessionId: null, endsAt: null, blocking: { state: "off", reason } });

export const NOT_INSTALLED = "Three isn’t installed, so nothing is blocked. The timer still runs.";

/** What a session would block right now, for the picker. */
export async function focusPreview(run: ThreeRun | null): Promise<FocusBlocking> {
  if (!run) return { state: "off", reason: NOT_INSTALLED };
  try {
    if (parseRunning(await run(["status", "--json"]))) return { state: "off", reason: "Three is already running a session, so this one won’t block anything." };
    return parseBlocking(await run(["block", "status", "--json"]));
  } catch (error) {
    return { state: "off", reason: `Three couldn’t be reached: ${(error as Error).message}` };
  }
}

/**
 * Starts a Three session of `minutes` on today's reading task for this book, adding the task the first time.
 * Anything Three refuses (a full day, a session already running) leaves the timer running without blocking.
 */
export async function startFocus(run: ThreeRun | null, { title, minutes }: { title: string; minutes: number }): Promise<FocusStart> {
  if (!run) return off(NOT_INSTALLED);
  try {
    if (parseRunning(await run(["status", "--json"]))) return off("Three is already running a session, so this one won’t block anything.");
    const taskTitle = `Read: ${title.slice(0, TITLE_LIMIT)}`;
    let taskId = findReadingTask(await run(["today", "--json"]), taskTitle);
    if (!taskId) {
      const add = ["add", taskTitle, "--block", String(minutes), "--tag", FOCUS_TAG];
      /* "Learning" is one of Three's starting categories, but it can be renamed away. */
      await run([...add, "--cat", "Learning"]).catch(() => run(add));
      taskId = findReadingTask(await run(["today", "--json"]), taskTitle);
      if (!taskId) return off("Three didn’t keep the reading task, so nothing is blocked.");
    }
    await run(["start", taskId, "--min", String(minutes)]);
    const session = parseRunning(await run(["status", "--json"]));
    const blocking = parseBlocking(await run(["block", "status", "--json"]));
    return { sessionId: session?.id ?? null, endsAt: session?.plannedEnd ?? null, blocking };
  } catch (error) {
    return off(`Three said: ${(error as Error).message} Nothing is blocked; the timer still runs.`);
  }
}

/** Ends the session early, but only the one this app started: anything else running in Three is left alone. */
export async function stopFocus(run: ThreeRun | null, sessionId: string): Promise<boolean> {
  if (!run) return false;
  const running = parseRunning(await run(["status", "--json"]));
  if (running?.id !== sessionId) return false;
  await run(["stop"]);
  return true;
}
