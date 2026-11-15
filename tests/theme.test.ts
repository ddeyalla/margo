import { describe, expect, it } from "vitest";
import { themeScript } from "@/components/ui/theme";

/* Runs the inline <head> script against a stand-in page, the way the browser would before first paint. */
function page(saved: string | null, prefersLight: boolean) {
  const store = new Map<string, string>();
  if (saved !== null) store.set("rigg-learn.theme", saved);
  const html = { dataset: {} as Record<string, string> };
  const handlers: Record<string, ((event: { key: string | null }) => void)[]> = {};
  const scheme = { matches: prefersLight, listeners: [] as (() => void)[], addEventListener: (_: string, fn: () => void) => scheme.listeners.push(fn) };
  const globals = {
    document: { documentElement: html },
    localStorage: { getItem: (key: string) => store.get(key) ?? null },
    matchMedia: () => scheme,
    addEventListener: (type: string, fn: (event: { key: string | null }) => void) => (handlers[type] ??= []).push(fn),
  };
  new Function(...Object.keys(globals), themeScript)(...Object.values(globals));
  return {
    theme: () => html.dataset.theme,
    save(value: string | null) {
      if (value === null) store.delete("rigg-learn.theme");
      else store.set("rigg-learn.theme", value);
      handlers.storage?.forEach((fn) => fn({ key: "rigg-learn.theme" }));
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
