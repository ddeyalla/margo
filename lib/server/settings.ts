import { stat } from "node:fs/promises";
import path from "node:path";
import { isLibraryView, isPanelTab, isReadAloudRate, isReadAloudVoice, isReadingFont, isReadingMode, isReadingTheme, type AppSettings, type SettingsChange } from "@/lib/shared/types";
import { getFolders, savedFolder } from "./config";
import { readJson, updateJson } from "./store";
import { isProviderId } from "./tutor/providers";
import { isObject } from "./validate";

const settingsFile = () => path.join(/*turbopackIgnore: true*/ getFolders().dataDir, "settings.json");

const normalize = (raw: unknown): AppSettings => {
  const value = isObject(raw) ? raw : {};
  const models: AppSettings["models"] = {};
  if (isObject(value.models)) {
    for (const [id, model] of Object.entries(value.models)) {
      if (isProviderId(id) && typeof model === "string" && model.trim()) models[id] = model.trim();
    }
  }
  return {
    provider: isProviderId(value.provider) ? value.provider : null,
    models,
    /* pdfDarkPages and epubTheme are the older settings, saved when the app was always dark: their
       dark pages matched the app, so they become auto, and a light page the reader picked stays light. */
    pdfPage: isReadingTheme(value.pdfPage) ? value.pdfPage : value.pdfDarkPages === false ? "light" : "auto",
    readingMode: isReadingMode(value.readingMode) ? value.readingMode : "scroll",
    epubPage: isReadingTheme(value.epubPage) ? value.epubPage : value.epubTheme === "light" ? "light" : "auto",
    boldStarts: value.boldStarts === true,
    readingFont: isReadingFont(value.readingFont) ? value.readingFont : null,
    chaptersOpen: value.chaptersOpen === true,
    panelTab: isPanelTab(value.panelTab) ? value.panelTab : "chat",
    readAloudVoice: isReadAloudVoice(value.readAloudVoice) ? value.readAloudVoice : null,
    readAloudRate: isReadAloudRate(value.readAloudRate) ? value.readAloudRate : 1,
    libraryView: isLibraryView(value.libraryView) ? value.libraryView : "shelf",
    booksDir: savedFolder(value.booksDir),
    notesDir: savedFolder(value.notesDir),
  };
};

export const readSettings = async (): Promise<AppSettings> => normalize(await readJson(settingsFile()));

export const saveSettings = (change: SettingsChange): Promise<AppSettings> =>
  updateJson(settingsFile(), () => normalize(null), (current) => ({ ...normalize(current), ...change }));

/** When settings.json last changed, in ms, or 0 if it was never written. */
export const settingsUpdatedAt = async (): Promise<number> => {
  try {
    return (await stat(settingsFile())).mtimeMs;
  } catch {
    return 0;
  }
};

export type FolderCheck = { ok: true; path: string | null } | { ok: false; error: string };

/** A folder for settings: an absolute path to a folder that exists, or null where `optional` allows it. */
export const checkFolder = async (name: string, value: unknown, optional: boolean): Promise<FolderCheck> => {
  if (value === null && optional) return { ok: true, path: null };
  const wanted = `${name} must be ${optional ? "null or " : ""}an absolute path to a folder that exists.`;
  if (typeof value !== "string" || !path.isAbsolute(value.trim())) return { ok: false, error: wanted };
  const folder = path.resolve(value.trim());
  const info = await stat(folder).catch(() => null);
  return info?.isDirectory() ? { ok: true, path: folder } : { ok: false, error: `${wanted} "${folder}" is not.` };
};
