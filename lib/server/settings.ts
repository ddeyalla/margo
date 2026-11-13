import path from "node:path";
import { isReadingMode, isReadingTheme, type AppSettings, type SettingsChange } from "@/lib/shared/types";
import { getConfig } from "./config";
import { readJson, updateJson } from "./store";
import { isProviderId } from "./tutor/providers";
import { isObject } from "./validate";

const settingsFile = () => path.join(getConfig().dataDir, "settings.json");

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
    pdfDarkPages: value.pdfDarkPages !== false,
    readingMode: isReadingMode(value.readingMode) ? value.readingMode : "scroll",
    epubTheme: isReadingTheme(value.epubTheme) ? value.epubTheme : "dark",
  };
};

export const readSettings = async (): Promise<AppSettings> => normalize(await readJson(settingsFile()));

export const saveSettings = (change: SettingsChange): Promise<AppSettings> =>
  updateJson(settingsFile(), () => normalize(null), (current) => ({ ...normalize(current), ...change }));
