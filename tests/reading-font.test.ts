import { describe, expect, it } from "vitest";
import { cssFamily, fontGroups, fontInEffect, fontLabel, SYSTEM_FONT } from "@/components/reader/fonts";
import { isReadingFont } from "@/lib/shared/types";

describe("the reading font picker", () => {
  it("suggests the installed reading faces first, in their order, with the system font always there", () => {
    const { suggested, others } = fontGroups(["Avenir Next", "Baskerville", "Fraunces", "Georgia", "SF Pro"]);
    expect(suggested).toEqual(["Georgia", "Baskerville", SYSTEM_FONT, "Avenir Next"]);
    expect(others).toEqual(["Fraunces", "SF Pro"]);
  });

  it("names Literata and the system font in words", () => {
    expect([null, SYSTEM_FONT, "Charter"].map(fontLabel)).toEqual(["Literata", "System (SF Pro)", "Charter"]);
  });

  it("quotes a family for CSS, escaping quotes and backslashes, and leaves the system keyword bare", () => {
    expect(cssFamily("Iowan Old Style")).toBe('"Iowan Old Style"');
    expect(cssFamily('Odd "Name"\\')).toBe('"Odd \\"Name\\"\\\\"');
    expect(cssFamily(SYSTEM_FONT)).toBe("system-ui");
  });

  it("falls back to Literata when the saved family is no longer installed", () => {
    expect(fontInEffect("Fraunces", ["Fraunces", "Georgia"])).toBe("Fraunces");
    expect(fontInEffect("Gone Sans", ["Fraunces", "Georgia"])).toBeNull();
    expect(fontInEffect(SYSTEM_FONT, [])).toBe(SYSTEM_FONT);
    expect(fontInEffect("Gone Sans", null)).toBe("Gone Sans");
  });

  it("saves only a short single-line family name or null", () => {
    expect([null, "Georgia", "New York"].every(isReadingFont)).toBe(true);
    expect(["", " Georgia", "Georgia\n", "a".repeat(201), 3, undefined].some(isReadingFont)).toBe(false);
  });
});
