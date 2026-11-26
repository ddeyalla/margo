import { beforeEach, describe, expect, it, vi } from "vitest";

/* The module keeps the session's count, so each test loads it fresh. Node has no sessionStorage, which the module treats as an empty one. */
const load = async () => {
  vi.resetModules();
  return import("@/lib/client/your-turn");
};

describe("the Your turn prompts of a session", () => {
  beforeEach(() => vi.unstubAllGlobals());

  const withStorage = () => {
    const items = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) });
    return items;
  };
  const stored = (items: Map<string, string>) => JSON.parse(items.get("rigg-learn:your-turn") ?? "null") as { offered: string | null; settled: string[]; skips: number };

  it("counts a prompt passed over by sending something else, and one dismissed", async () => {
    const items = withStorage();
    const turns = await load();
    turns.offerYourTurn("a");
    turns.passYourTurn();
    expect(stored(items)).toEqual({ offered: null, settled: ["a"], skips: 1 });
    turns.offerYourTurn("b");
    turns.dismissYourTurn("b");
    expect(stored(items)).toMatchObject({ settled: ["a", "b"], skips: 2 });
  });

  it("doesn't count a prompt that was taken, or passing with none on offer", async () => {
    const items = withStorage();
    const turns = await load();
    turns.passYourTurn();
    turns.offerYourTurn("a");
    turns.takeYourTurn("a");
    turns.passYourTurn();
    expect(stored(items)).toEqual({ offered: null, settled: ["a"], skips: 0 });
  });

  it("counts a prompt still on offer when the next answer brings another", async () => {
    const items = withStorage();
    const turns = await load();
    turns.offerYourTurn("a");
    turns.offerYourTurn("b");
    expect(stored(items)).toEqual({ offered: "b", settled: ["a"], skips: 1 });
  });

  it("doesn't count dismissing an old thread's prompt, which this session never offered", async () => {
    const items = withStorage();
    const turns = await load();
    turns.dismissYourTurn("old");
    expect(stored(items)).toEqual({ offered: null, settled: ["old"], skips: 0 });
  });

  it("stops showing prompts once two were passed over, and never shows a settled one again", async () => {
    withStorage();
    const turns = await load();
    expect(turns.yourTurnShown("a")).toBe(true);
    turns.offerYourTurn("a");
    turns.takeYourTurn("a");
    expect(turns.yourTurnShown("a")).toBe(false);
    turns.offerYourTurn("b");
    turns.dismissYourTurn("b");
    expect(turns.yourTurnShown("c")).toBe(true);
    turns.offerYourTurn("c");
    turns.passYourTurn();
    expect(turns.yourTurnShown("d")).toBe(false);
  });

  it("works without storage, for as long as the page lives", async () => {
    const turns = await load();
    turns.offerYourTurn("a");
    turns.passYourTurn();
    turns.offerYourTurn("b");
    turns.passYourTurn();
    expect(turns.yourTurnShown("c")).toBe(false);
  });

  it("keeps the count across a reload of the page", async () => {
    const items = withStorage();
    const first = await load();
    first.offerYourTurn("a");
    first.passYourTurn();
    const second = await load();
    second.offerYourTurn("b");
    second.passYourTurn();
    expect(stored(items).skips).toBe(2);
  });
});
