import { GlobalFonts } from "@napi-rs/canvas";

/* Families with no letters to read a book in: emoji, symbols, dingbats, Braille, the
   last-resort glyph font, and the name the system gives its own interface font. */
const UNREADABLE = /emoji|symbol|dingbat|braille|ornament|webdings|wingdings|last ?resort|^system font$/i;

/** The family names worth offering as a reading font: each once, without hidden or symbol families, sorted. */
export const readableFamilies = (families: string[]) =>
  Array.from(new Set(families.map((family) => family.trim())))
    .filter((family) => family && !family.startsWith(".") && !UNREADABLE.test(family))
    .sort((a, b) => a.localeCompare(b));

let installed: string[] | null = null;

/**
 * The font families installed on this Mac, in /System/Library/Fonts, /Library/Fonts and
 * ~/Library/Fonts among other places, read once. They come from the system's own font list,
 * the one the browser matches a CSS font-family against, so every name here renders by that name.
 */
export const installedFonts = () => (installed ??= readableFamilies(GlobalFonts.families.map(({ family }) => family)));
