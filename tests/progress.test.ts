import { describe, expect, it } from "vitest";
import { pageLabel, pagesLeftLabel, percentLabel } from "@/components/book/progress";

describe("footer labels", () => {
  it("shows a print page by the book's own label", () => {
    expect(pageLabel({ kind: "print", label: "34" })).toBe("p. 34");
    expect(pageLabel({ kind: "print", label: "xii" })).toBe("p. xii");
  });

  it("counts locations from 1, with thousands separated", () => {
    expect(pageLabel({ kind: "location", current: 119, total: 2400 })).toBe("Loc 120 of 2,400");
    expect(pageLabel({ kind: "location", current: 0, total: 563 })).toBe("Loc 1 of 563");
  });

  it("never shows a location past the last", () => {
    expect(pageLabel({ kind: "location", current: 563, total: 563 })).toBe("Loc 563 of 563");
  });

  it("shows a PDF page with the page count", () => {
    expect(pageLabel({ kind: "pdf", page: 12, total: 340 })).toBe("p. 12 of 340");
    expect(pageLabel({ kind: "pdf", page: 1024, total: 1200 })).toBe("p. 1,024 of 1,200");
  });

  it("says how many pages are left in the chapter", () => {
    expect(pagesLeftLabel(8)).toBe("8 pages left in chapter");
    expect(pagesLeftLabel(1)).toBe("1 page left in chapter");
    expect(pagesLeftLabel(0)).toBe("Last page in chapter");
  });

  it("rounds the share of the book to a whole percent within 0 and 100", () => {
    expect(percentLabel(0.344)).toBe("34%");
    expect(percentLabel(0.995)).toBe("100%");
    expect(percentLabel(1.2)).toBe("100%");
    expect(percentLabel(-0.1)).toBe("0%");
  });
});
