"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Segmented } from "./index";

/** The app's colours: follow macOS, or always light or dark. Kept in this browser's storage. */
export type AppTheme = "system" | "light" | "dark";

const KEY = "margo.theme";

/**
 * The colours in force for a stored choice. Written into the inline script as source, so it must stay
 * self-contained: no imports, helpers or newer syntax.
 */
function resolveTheme(saved: string | null, prefersLight: boolean): "light" | "dark" {
  return saved === "light" || saved === "dark" ? saved : prefersLight ? "light" : "dark";
}

/**
 * Moves this browser's saved settings from the app's old name to "margo" once, before anything reads them.
 * Self-contained for the same reason as resolveTheme.
 */
function moveOldKeys(store: Storage) {
  for (let i = store.length - 1; i >= 0; i--) {
    const key = store.key(i);
    if (!key || key.indexOf("rigg-learn") !== 0) continue;
    const moved = "margo" + key.slice(10);
    if (store.getItem(moved) === null) store.setItem(moved, store.getItem(key) as string);
    store.removeItem(key);
  }
}

/**
 * Runs in <head> before the first paint, so the page never flashes the wrong colours.
 * It sets data-theme on <html> to light or dark, follows macOS while the choice is "system",
 * and follows a choice made in another window.
 */
export const themeScript = `(function(){try{(${moveOldKeys.toString()})(localStorage);var k=${JSON.stringify(KEY)},r=(${resolveTheme.toString()}),m=matchMedia("(prefers-color-scheme: light)"),a=function(){document.documentElement.dataset.theme=r(localStorage.getItem(k),m.matches)};a();m.addEventListener("change",a);addEventListener("storage",function(e){if(e.key===k||e.key===null)a()})}catch(e){}})()`;

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
  document.documentElement.dataset.theme = resolveTheme(theme === "system" ? null : theme, matchMedia("(prefers-color-scheme: light)").matches);
  listeners.forEach((listener) => listener());
};

/* A choice made in another window arrives as a storage event; the inline script re-applies it, and this updates the control. */
const subscribe = (listener: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
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
