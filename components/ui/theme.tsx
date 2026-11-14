"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Segmented } from "./index";

/** The app's colours: follow macOS, or always light or dark. Kept in this browser's storage. */
export type AppTheme = "system" | "light" | "dark";

const KEY = "rigg-learn.theme";

/**
 * Runs in <head> before the first paint, so the page never flashes the wrong colours.
 * It sets data-theme on <html> to light or dark and follows macOS while the choice is "system".
 */
export const themeScript = `(function(){try{var k=${JSON.stringify(KEY)},m=matchMedia("(prefers-color-scheme: light)"),a=function(){var c=localStorage.getItem(k);document.documentElement.dataset.theme=c==="light"||c==="dark"?c:m.matches?"light":"dark"};a();m.addEventListener("change",a)}catch(e){}})()`;

const listeners = new Set<() => void>();

const read = (): AppTheme => {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
};

const choose = (theme: AppTheme) => {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    /* Storage is off: the choice lasts until the page reloads. */
  }
  const light = theme === "light" || (theme === "system" && matchMedia("(prefers-color-scheme: light)").matches);
  document.documentElement.dataset.theme = light ? "light" : "dark";
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const OPTIONS: { value: AppTheme; label: string; icon: React.ReactNode }[] = [
  { value: "system", label: "Match macOS", icon: <Monitor /> },
  { value: "light", label: "Light", icon: <Sun /> },
  { value: "dark", label: "Dark", icon: <Moon /> },
];

export function ThemeControl() {
  const theme = useSyncExternalStore(subscribe, read, () => "system" as const);
  return <Segmented label="App colours" options={OPTIONS} value={theme} onChange={choose} />;
}

const observeTheme = (listener: () => void) => {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
};

/** The theme in force right now, light or dark, kept current as the choice or macOS changes. */
export function useResolvedTheme(): "light" | "dark" {
  return useSyncExternalStore(
    observeTheme,
    () => (document.documentElement.dataset.theme === "light" ? "light" : "dark"),
    () => "dark",
  );
}
