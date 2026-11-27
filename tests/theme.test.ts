import { describe, expect, it } from "vitest";
import { themeScript } from "@/components/ui/theme";

/* Runs the inline <head> script against a stand-in page, the way the browser would before first paint. */
function storage(store: Map<string, string>) {
  return {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
}

function page(saved: string | null, prefersLight: boolean, store = new Map<string, string>()) {
  if (saved !== null) store.set("margo.theme", saved);
  const html = { dataset: {} as Record<string, string> };
  const handlers: Record<string, ((event: { key: string | null }) => void)[]> = {};
  const scheme = { matches: prefersLight, listeners: [] as (() => void)[], addEventListener: (_: string, fn: () => void) => scheme.listeners.push(fn) };
  const globals = {
    document: { documentElement: html },
    localStorage: storage(store),
    matchMedia: () => scheme,
    addEventListener: (type: string, fn: (event: { key: string | null }) => void) => (handlers[type] ??= []).push(fn),
  };
  new Function(...Object.keys(globals), themeScript)(...Object.values(globals));
  return {
    theme: () => html.dataset.theme,
    save(value: string | null) {
      if (value === null) store.delete("margo.theme");
      else store.set("margo.theme", value);
      handlers.storage?.forEach((fn) => fn({ key: "margo.theme" }));
    },
    macOS(light: boolean) {
      scheme.matches = light;
      scheme.listeners.forEach((fn) => fn());
    },
  };
}

describe("themeScript", () => {
  it("applies the saved choice, else follows macOS", () => {
    expect(page("light", false).theme()).toBe("light");
    expect(page("dark", true).theme()).toBe("dark");
    expect(page(null, true).theme()).toBe("light");
    expect(page("nonsense", false).theme()).toBe("dark");
  });

  it("follows macOS while on system", () => {
    const p = page(null, false);
    p.macOS(true);
    expect(p.theme()).toBe("light");
  });

  it("follows a choice made in another window", () => {
    const p = page(null, false);
    expect(p.theme()).toBe("dark");
    p.save("light");
    expect(p.theme()).toBe("light");
    p.save(null);
    expect(p.theme()).toBe("dark");
  });
});

describe("settings saved under the old name", () => {
  it("move to the margo keys once, before the theme is read", () => {
    const store = new Map([
      ["rigg-learn.theme", "light"],
      ["rigg-learn:your-turn", "{}"],
      ["other", "kept"],
    ]);
    expect(page(null, false, store).theme()).toBe("light");
    expect(Object.fromEntries(store)).toEqual({ "margo.theme": "light", "margo:your-turn": "{}", other: "kept" });
  });

  it("never overwrite a value already saved under the new name", () => {
    const store = new Map([
      ["margo.theme", "dark"],
      ["rigg-learn.theme", "light"],
    ]);
    expect(page(null, true, store).theme()).toBe("dark");
    expect(store.has("rigg-learn.theme")).toBe(false);
  });
});
