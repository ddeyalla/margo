import type { ReadingFont } from "@/lib/shared/types";

/** The system's interface font, San Francisco on a Mac. Always there, so it needs no install check. */
export const SYSTEM_FONT = "system-ui";

/* Faces made for reading, offered before the full list when this Mac has them. Literata, the default, comes first. */
const SUGGESTED = ["Georgia", "Charter", "Iowan Old Style", "New York", "Palatino", "Baskerville", SYSTEM_FONT, "Avenir Next"];

/** The suggested fonts this Mac has, in order, and every other installed family after them. */
export const fontGroups = (installed: string[]) => {
  const have = new Set(installed);
  const suggested = SUGGESTED.filter((family) => family === SYSTEM_FONT || have.has(family));
  return { suggested, others: installed.filter((family) => !suggested.includes(family)) };
};

/** A family as a CSS font-family value: the system font by its keyword, any other name quoted. */
export const cssFamily = (family: string) => (family === SYSTEM_FONT ? family : `"${family.replace(/["\\]/g, "\\$&")}"`);

/** The name the picker shows for a reading font. */
export const fontLabel = (font: ReadingFont) => (font === null ? "Literata" : font === SYSTEM_FONT ? "System (SF Pro)" : font);

/** The font in effect: a family that is no longer installed falls back to Literata. Unknown until the list arrives. */
export const fontInEffect = (font: ReadingFont, installed: string[] | null) =>
  font === null || font === SYSTEM_FONT || !installed || installed.includes(font) ? font : null;
