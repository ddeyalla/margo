import { describe, expect, it } from "vitest";
import { FOCUS_TAG, NOT_INSTALLED, focusPreview, startFocus, stopFocus, type ThreeRun } from "@/lib/server/focus";
import { blockingLine, clampFocusMinutes } from "@/lib/shared/focus";

type Task = { id: string; title: string; status: string; tags: string[] };

/** A stand-in for the `three` CLI over an in-memory day, recording every call. */
function fakeThree({
  tasks = [] as Task[],
  running = null as { id: string; plannedEnd: string } | null,
  rules = [{ kind: "domain", enabled: true }, { kind: "app", enabled: true }] as { kind: string; enabled: boolean }[],
  connectedProfiles = 1,
  categories = ["Learning"],
  dayFull = false,
} = {}) {
  const calls: string[][] = [];
  const run: ThreeRun = async (args) => {
    calls.push(args);
    const [command, ...rest] = args;
    if (command === "status") return JSON.stringify(running);
    if (command === "today") return JSON.stringify({ tasks });
    if (command === "block") return JSON.stringify({ rules, chrome: { connectedProfiles } });
    if (command === "add") {
      if (dayFull) throw new Error("Five tasks is the most a day can hold.");
      const cat = rest.indexOf("--cat");
      if (cat !== -1 && !categories.includes(rest[cat + 1])) throw new Error(`No category named "${rest[cat + 1]}".`);
      tasks.push({ id: `task-${tasks.length + 1}`, title: rest[0], status: "todo", tags: [FOCUS_TAG] });
      return "";
    }
    if (command === "start") {
      running = { id: "session-1", plannedEnd: "2026-11-25T19:00:00Z" };
      return "";
    }
    if (command === "stop") {
      running = null;
      return "";
    }
    throw new Error(`unexpected ${args.join(" ")}`);
  };
  return { run, calls, tasks };
}

describe("focus sessions through Three", () => {
  it("adds a tagged reading task, starts it, and reports Three's end time and block list", async () => {
    const three = fakeThree();
    const started = await startFocus(three.run, { title: "Deep Work", minutes: 30 });
    expect(started).toEqual({ sessionId: "session-1", endsAt: "2026-11-25T19:00:00Z", blocking: { state: "on", sites: 1, apps: 1, chromeConnected: true } });
    expect(three.calls).toContainEqual(["add", "Read: Deep Work", "--block", "30", "--tag", FOCUS_TAG, "--cat", "Learning"]);
    expect(three.calls).toContainEqual(["start", "task-1", "--min", "30"]);
  });

  it("reuses today's task for the same book instead of adding another", async () => {
    const three = fakeThree({ tasks: [{ id: "mine", title: "Read: Deep Work", status: "partial", tags: [FOCUS_TAG] }] });
    await startFocus(three.run, { title: "Deep Work", minutes: 25 });
    expect(three.calls.some(([command]) => command === "add")).toBe(false);
    expect(three.calls).toContainEqual(["start", "mine", "--min", "25"]);
  });

  it("ignores an untagged task that happens to share the title", async () => {
    const three = fakeThree({ tasks: [{ id: "theirs", title: "Read: Deep Work", status: "todo", tags: [] }] });
    await startFocus(three.run, { title: "Deep Work", minutes: 25 });
    expect(three.calls).toContainEqual(["start", "task-2", "--min", "25"]);
  });

  it("adds without a category when Learning has been renamed away", async () => {
    const three = fakeThree({ categories: ["Coding"] });
    const started = await startFocus(three.run, { title: "Deep Work", minutes: 30 });
    expect(started.sessionId).toBe("session-1");
    expect(three.calls).toContainEqual(["add", "Read: Deep Work", "--block", "30", "--tag", FOCUS_TAG]);
  });

  it("leaves a session the person started in Three alone", async () => {
    const three = fakeThree({ running: { id: "theirs", plannedEnd: "2026-11-25T18:30:00Z" } });
    const started = await startFocus(three.run, { title: "Deep Work", minutes: 30 });
    expect(started).toMatchObject({ sessionId: null, endsAt: null, blocking: { state: "off" } });
    expect(three.calls.map(([command]) => command)).toEqual(["status"]);
    expect(await stopFocus(three.run, "session-1")).toBe(false);
    expect(three.calls.some(([command]) => command === "stop")).toBe(false);
  });

  it("keeps the timer, unblocked, when Three refuses the task", async () => {
    const started = await startFocus(fakeThree({ dayFull: true }).run, { title: "Deep Work", minutes: 30 });
    expect(started.sessionId).toBeNull();
    expect(started.blocking).toMatchObject({ state: "off" });
    expect(blockingLine(started.blocking)).toContain("Five tasks is the most a day can hold.");
  });

  it("works without Three installed", async () => {
    expect(await startFocus(null, { title: "Deep Work", minutes: 30 })).toEqual({ sessionId: null, endsAt: null, blocking: { state: "off", reason: NOT_INSTALLED } });
    expect(await focusPreview(null)).toEqual({ state: "off", reason: NOT_INSTALLED });
  });

  it("stops only its own session", async () => {
    const three = fakeThree();
    const { sessionId } = await startFocus(three.run, { title: "Deep Work", minutes: 30 });
    expect(await stopFocus(three.run, "someone-else")).toBe(false);
    expect(await stopFocus(three.run, sessionId!)).toBe(true);
  });

  it("says when the block list is empty or websites can't reach Chrome", async () => {
    expect(await focusPreview(fakeThree({ rules: [] }).run)).toMatchObject({ state: "off" });
    const preview = await focusPreview(fakeThree({ connectedProfiles: 0 }).run);
    expect(blockingLine(preview)).toBe("Blocks 1 app through Three. Websites aren’t blocked until Chrome is connected to Three.");
  });

  it("accepts whole minutes in range only", () => {
    expect(clampFocusMinutes(30)).toBe(30);
    expect(clampFocusMinutes(2)).toBeNull();
    expect(clampFocusMinutes(30.5)).toBeNull();
    expect(clampFocusMinutes("30")).toBeNull();
  });
});
