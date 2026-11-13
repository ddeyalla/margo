import { describe, expect, it, vi } from "vitest";
import { installedFonts, readableFamilies } from "@/lib/server/fonts";

/* The system's font list, as the native canvas reports it: one entry per family, hidden ones included. */
const system = vi.hoisted(() => ({
  reads: 0,
  families: [
    "Georgia",
    ".SF NS Mono",
    "Apple Color Emoji",
    ".LastResort",
    "Fraunces",
    "Zapf Dingbats",
    "Avenir Next",
    "Apple Symbols",
    "System Font",
    "Bodoni Ornaments",
    "Webdings",
    "Wingdings 3",
    "Apple Braille",
    "Hiragino Sans",
    "Noto Color Emoji",
    "Iowan Old Style",
  ],
}));

vi.mock("@napi-rs/canvas", () => ({
  GlobalFonts: {
    get families() {
      system.reads += 1;
      return system.families.map((family) => ({ family, styles: [] }));
    },
  },
}));

describe("installed fonts", () => {
  it("keeps the families with letters to read, each once, sorted", () => {
    expect(readableFamilies(["Palatino", "avenir", "Georgia", " Georgia ", "Ébène", "Charter", "Georgia"])).toEqual([
      "avenir",
      "Charter",
      "Ébène",
      "Georgia",
      "Palatino",
    ]);
  });

  it("leaves out hidden families and emoji, symbol, dingbat and Braille fonts", () => {
    expect(installedFonts()).toEqual(["Avenir Next", "Fraunces", "Georgia", "Hiragino Sans", "Iowan Old Style"]);
  });

  it("reads the system's list once", () => {
    installedFonts();
    installedFonts();
    expect(system.reads).toBe(1);
  });
});
