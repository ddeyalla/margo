import { describe, expect, it } from "vitest";
import { findBlock, linkTarget, parseWikiLinks, resolveWikiLink } from "@/lib/shared/wikilinks";

describe("wikilinks", () => {
  it("reads targets, headings, blocks, aliases and embeds", () => {
    const links = parseWikiLinks("a [[Note]] b [[Note#Part|shown]] ![[Book#^h-1a2b3c4d]] [[#Local]] [[]]");
    expect(links.map(({ embed, target, subpath, alias }) => ({ embed, target, subpath, alias }))).toEqual([
      { embed: false, target: "Note", subpath: null, alias: null },
      { embed: false, target: "Note", subpath: "Part", alias: "shown" },
      { embed: true, target: "Book", subpath: "^h-1a2b3c4d", alias: null },
      { embed: false, target: "", subpath: "Local", alias: null },
    ]);
    expect(links[0]).toMatchObject({ from: 2, to: 10 });
  });

  it("resolves like Obsidian: same folder first, then the shortest path, any case", () => {
    const paths = ["Note.md", "deep/down/Note.md", "here/Note.md", "here/Other.md", "img/pic.png"];
    expect(resolveWikiLink("note", "here/Other.md", paths)).toBe("here/Note.md");
    expect(resolveWikiLink("Note", "elsewhere/x.md", paths)).toBe("Note.md");
    expect(resolveWikiLink("deep/down/Note", "x.md", paths)).toBe("deep/down/Note.md");
    expect(resolveWikiLink("pic.png", "x.md", paths)).toBe("img/pic.png");
    expect(resolveWikiLink("Nope", "x.md", paths)).toBeNull();
    expect(resolveWikiLink("", "x.md", paths)).toBe("x.md");
  });

  it("writes a link by title unless another note has the same title", () => {
    expect(linkTarget("a/Solo.md", ["a/Solo.md", "b/Other.md"])).toBe("Solo");
    expect(linkTarget("a/Note.md", ["a/Note.md", "b/Note.md"])).toBe("a/Note");
  });

  it("finds a block by its id: a multi-line quote, a paragraph, or one list item", () => {
    const text = ["## Ch", "", "> Line one.", ">", "> Line two. ^h-11111111", "", "Para one", "para two ^p1", "", "- a", "- b ^li", "- c"].join("\n");
    expect(findBlock(text, "h-11111111")).toBe("Line one.\n\nLine two.");
    expect(findBlock(text, "p1")).toBe("Para one\npara two");
    expect(findBlock(text, "li")).toBe("- b");
    expect(findBlock(text, "missing")).toBeNull();
  });
});
