import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { changeAnnotations, parseChange } from "@/lib/server/annotations";
import { readBookState } from "@/lib/server/store";
import { applyChange, byChapter } from "@/lib/shared/annotations";
import { compareCfi } from "@/lib/shared/cfi";
import { parseTags } from "@/lib/shared/tags";
import { emptyBookState, type BookId, type LibraryBook } from "@/lib/shared/types";

const H1 = "11111111-1111-4111-8111-111111111111";
const H2 = "22222222-2222-4222-8222-222222222222";
const N1 = "33333333-3333-4333-8333-333333333333";
const passage = { anchor: { kind: "pdf", page: 3, start: 10, end: 40 }, quote: "The selected words.", chapterTitle: "Chapter 2" };
const NOW = "2026-11-13T12:00:00.000Z";

const change = (method: "POST" | "PATCH" | "DELETE", body: unknown) => {
  const parsed = parseChange(method, body, "pdf");
  if (typeof parsed === "string") throw new Error(parsed);
  return parsed;
};

describe("annotation changes", () => {
  it("adds a highlight once, however often the request is sent", () => {
    const add = change("POST", { op: "add-highlight", highlight: { id: H1, ...passage } });
    const once = applyChange(emptyBookState(), add, NOW);
    expect(applyChange(once, add, NOW)).toEqual(once);
    expect(once.highlights).toEqual([{ id: H1, ...passage, color: "amber", createdAt: NOW }]);
  });

  it("marks a note's passage, reusing a highlight already on it", () => {
    const fresh = applyChange(emptyBookState(), change("POST", { op: "add-note", note: { id: N1, ...passage, body: "Why? #question" }, highlightId: H2 }), NOW);
    expect(fresh.highlights.map((h) => h.id)).toEqual([H2]);
    expect(fresh.notes[0]).toMatchObject({ highlightId: H2, tags: ["question"], body: "Why? #question" });

    const highlighted = applyChange(emptyBookState(), change("POST", { op: "add-highlight", highlight: { id: H1, ...passage } }), NOW);
    const reused = applyChange(highlighted, change("POST", { op: "add-note", note: { id: N1, ...passage, body: "Hm." }, highlightId: H2 }), NOW);
    expect(reused.highlights.map((h) => h.id)).toEqual([H1]);
    expect(reused.notes[0].highlightId).toBe(H1);
  });

  it("re-reads tags when a note is edited, and keeps a note when its highlight goes", () => {
    let state = applyChange(emptyBookState(), change("POST", { op: "add-note", note: { id: N1, ...passage, body: "First." }, highlightId: H1 }), NOW);
    state = applyChange(state, change("PATCH", { op: "edit-note", id: N1, body: "Second #later" }), "2026-11-14T00:00:00.000Z");
    expect(state.notes[0]).toMatchObject({ body: "Second #later", tags: ["later"], updatedAt: "2026-11-14T00:00:00.000Z" });
    state = applyChange(state, change("DELETE", { op: "remove-highlight", id: H1 }), NOW);
    expect(state.highlights).toEqual([]);
    expect(state.notes[0]).toMatchObject({ id: N1, highlightId: null });
    state = applyChange(state, change("DELETE", { op: "remove-note", id: N1 }), NOW);
    expect(state.notes).toEqual([]);
  });

  it("refuses what it cannot trust", () => {
    expect(parseChange("POST", { op: "add-highlight", highlight: { id: "../x", ...passage } }, "pdf")).toBe("Invalid highlight.");
    expect(parseChange("POST", { op: "add-highlight", highlight: { id: H1, ...passage } }, "epub")).toBe("Invalid highlight.");
    expect(parseChange("POST", { op: "add-note", note: { id: N1, ...passage, body: "   " }, highlightId: H1 }, "pdf")).toBe("Invalid note.");
    expect(parseChange("PATCH", { op: "remove-highlight", id: H1 }, "pdf")).toBe("Send remove-highlight as DELETE.");
    expect(parseChange("POST", { op: "rename", id: H1 }, "pdf")).toBe("Unknown change.");
  });

  it("keeps the saved change when the notes folder cannot be written", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "rigg-learn-annotations-"));
    await writeFile(path.join(base, "file"), "");
    const book: LibraryBook = {
      id: "d".repeat(40) as BookId,
      format: "pdf",
      relPath: "A.pdf",
      folder: "",
      fileTitle: "A Book",
      fileAuthor: null,
      sizeBytes: 1,
      modifiedAt: NOW,
    };
    const dataDir = path.join(base, "data");
    const result = await changeAnnotations(book, change("POST", { op: "add-highlight", highlight: { id: H1, ...passage } }), {
      dataDir,
      notesDir: path.join(base, "file", "Notes"),
    });
    expect(result.vault.state).toBe("failed");
    expect((await readBookState(book.id, dataDir)).highlights.map((h) => h.id)).toEqual([H1]);

    const written = await changeAnnotations(book, change("POST", { op: "add-highlight", highlight: { id: H2, ...passage, quote: "More." } }), {
      dataDir,
      notesDir: path.join(base, "Notes"),
    });
    expect(written.vault).toEqual({ state: "written", file: path.join(base, "Notes", "A Book.md") });
    expect(await readFile(path.join(base, "Notes", "A Book.md"), "utf8")).toContain("> More. ^h-22222222");
  });
});

describe("tags", () => {
  it("reads #tags from prose, not headings, code, links or numbers", () => {
    expect(parseTags("# Heading\nA #idea and #nested/tag, (#paren) #2024 #v2 #Idea\n`#code` x#no [a](#anchor)")).toEqual([
      "idea",
      "nested/tag",
      "v2",
    ]);
    expect(parseTags("```\n#fenced\n```\n#after-fence #ünïcode")).toEqual(["after-fence", "ünïcode"]);
    expect(parseTags("")).toEqual([]);
  });
});

describe("reading order", () => {
  const real = "epubcfi(/6/14!/4/2[sbo-rt-content]/2/2[sec_intro],/2,/6/2[sec_terminology]/6/5:9)";

  it("orders CFIs by section, then path, then character", () => {
    expect(compareCfi(real, "epubcfi(/6/16!/4/2/1:0)")).toBeLessThan(0);
    expect(compareCfi("epubcfi(/6/14!/4/2[sbo-rt-content]/2/2[sec_intro]/2/1:0)", real)).toBeGreaterThan(0);
    expect(compareCfi("epubcfi(/6/14!/4/2/2/2/1:3)", "epubcfi(/6/14!/4/2/2/2/1:12)")).toBeLessThan(0);
    expect(compareCfi("epubcfi(/6/14!/4/10/1,:5,:20)", "epubcfi(/6/14!/4/10/1:4)")).toBeGreaterThan(0);
    expect(compareCfi(real, real)).toBe(0);
  });

  it("groups passages into runs of the same chapter", () => {
    const at = (page: number, chapterTitle: string | null) => ({
      anchor: { kind: "pdf" as const, page, start: 0, end: 1 },
      chapterTitle,
      createdAt: NOW,
    });
    const groups = byChapter([at(9, "Problem"), at(2, "Pattern 1"), at(3, "Problem"), at(8, "Pattern 2"), at(4, "Problem")]);
    expect(groups.map((g) => [g.title, g.items.map((i) => i.anchor.page)])).toEqual([
      ["Pattern 1", [2]],
      ["Problem", [3, 4]],
      ["Pattern 2", [8]],
      ["Problem", [9]],
    ]);
  });
});
