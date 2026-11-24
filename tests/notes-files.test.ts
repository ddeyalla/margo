import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { conflictName, contentHash, NotesPathError, resolveInside, saveIfUnchanged } from "@/lib/server/notes-folder";
import {
  attachmentFolder,
  backlinks,
  createNote,
  GeneratedFileError,
  listHighlightBlocks,
  listNotes,
  openNote,
  readEmbed,
  saveImage,
  saveNote,
} from "@/lib/server/notes";
import { renderVault } from "@/lib/server/vault";
import type { BookId } from "@/lib/shared/types";

let dir: string;
const AT = new Date(2026, 10, 24, 14, 32, 5);

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "rigg-notes-"));
});

const put = async (rel: string, text: string) => {
  await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await writeFile(path.join(dir, rel), text);
};
const read = (rel: string) => readFile(path.join(dir, rel), "utf8");

describe("saving a note never overwrites a change made on disk", () => {
  it("saves when the file is still the version that was opened", async () => {
    await put("Ideas.md", "first");
    const opened = await openNote(dir, "Ideas.md");
    const saved = await saveNote(dir, "Ideas.md", "second", opened!.hash);
    expect(saved).toEqual({ state: "saved", hash: contentHash("second") });
    expect(await read("Ideas.md")).toBe("second");
    /* The new hash is the base for the next save. */
    expect(await saveNote(dir, "Ideas.md", "third", contentHash("second"))).toMatchObject({ state: "saved" });
    expect(await read("Ideas.md")).toBe("third");
  });

  it("keeps both when the file changed since it was opened: the disk version stays, the app's text goes to a copy", async () => {
    await put("Ideas.md", "first");
    const opened = await openNote(dir, "Ideas.md");
    await put("Ideas.md", "changed in Obsidian");
    const saved = await saveIfUnchanged(path.join(dir, "Ideas.md"), "typed in the app", opened!.hash, AT);
    expect(saved).toMatchObject({ state: "conflict", current: { text: "changed in Obsidian", hash: contentHash("changed in Obsidian") } });
    expect(await read("Ideas.md")).toBe("changed in Obsidian");
    expect(await read("Ideas (conflict 2026-11-24 14.32).md")).toBe("typed in the app");
  });

  it("answers the copy's path relative to the notes folder, and never reuses a copy's name", async () => {
    await put("sub/Ideas.md", "first");
    const { hash } = (await openNote(dir, "sub/Ideas.md"))!;
    await put("sub/Ideas.md", "changed");
    const first = await saveNote(dir, "sub/Ideas.md", "mine 1", hash);
    const second = await saveNote(dir, "sub/Ideas.md", "mine 2", hash);
    expect(first.state === "conflict" && first.copy).toMatch(/^sub\/Ideas \(conflict \d{4}-\d\d-\d\d \d\d\.\d\d\)\.md$/);
    expect(second.state === "conflict" && second.copy).toMatch(/^sub\/Ideas \(conflict [^)]+\) 1\.md$/);
    expect(await read("sub/Ideas.md")).toBe("changed");
    expect(await read((first as { copy: string }).copy)).toBe("mine 1");
    expect(await read((second as { copy: string }).copy)).toBe("mine 2");
  });

  it("does not bring back a file deleted on disk: the text goes to a copy", async () => {
    await put("Gone.md", "first");
    const { hash } = (await openNote(dir, "Gone.md"))!;
    await rm(path.join(dir, "Gone.md"));
    const saved = await saveIfUnchanged(path.join(dir, "Gone.md"), "still typing", hash, AT);
    expect(saved).toMatchObject({ state: "conflict", current: null });
    expect(await readdir(dir)).toEqual(["Gone (conflict 2026-11-24 14.32).md"]);
  });

  it("treats a rewrite with the same bytes as no change", async () => {
    await put("Same.md", "text");
    const { hash } = (await openNote(dir, "Same.md"))!;
    await put("Same.md", "text");
    expect(await saveNote(dir, "Same.md", "new", hash)).toMatchObject({ state: "saved" });
  });

  it("answers a repeated save of the same text as saved, without a copy", async () => {
    await put("Twice.md", "base");
    const hash = contentHash("base");
    expect(await saveNote(dir, "Twice.md", "new", hash)).toMatchObject({ state: "saved" });
    expect(await saveNote(dir, "Twice.md", "new", hash)).toEqual({ state: "saved", hash: contentHash("new") });
    expect(await readdir(dir)).toEqual(["Twice.md"]);
  });

  it("queues saves to one file, so two saves from the same version can't both win", async () => {
    await put("Race.md", "base");
    const hash = contentHash("base");
    const [a, b] = await Promise.all([saveNote(dir, "Race.md", "a", hash), saveNote(dir, "Race.md", "b", hash)]);
    expect([a.state, b.state].sort()).toEqual(["conflict", "saved"]);
    /* Whichever reached the queue first is in the file; the other is in a copy. */
    expect(await read("Race.md")).toBe(a.state === "saved" ? "a" : "b");
    const other = a.state === "conflict" ? a : b;
    expect(other.state === "conflict" && (await read(other.copy))).toBe(a.state === "conflict" ? "a" : "b");
  });

  it("names conflict copies by the local time", () => {
    expect(conflictName("Note", AT)).toBe("Note (conflict 2026-11-24 14.32)");
  });
});

describe("creating notes", () => {
  it("never replaces a file, even one that appears between listing and creating", async () => {
    await put("Untitled.md", "someone's note");
    expect(await createNote(dir, "", "")).toBe("Untitled 1.md");
    expect(await createNote(dir, "Plan: week 1", "projects")).toBe("projects/Plan week 1.md");
    expect(await read("Untitled.md")).toBe("someone's note");
  });
});

describe("what the app may touch in the notes folder", () => {
  it("refuses paths outside the folder, hidden files, other kinds of file and links out", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "rigg-outside-"));
    await writeFile(path.join(outside, "secret.md"), "secret");
    await symlink(outside, path.join(dir, "linked"));
    for (const bad of ["../x.md", "/etc/passwd.md", "a/../../x.md", ".obsidian/workspace.md", "notes.txt", "linked/secret.md", "", "a//b.md"]) {
      await expect(resolveInside(dir, bad, [".md"]), bad).rejects.toBeInstanceOf(NotesPathError);
    }
    await expect(saveNote(dir, "linked/secret.md", "x", contentHash("secret"))).rejects.toBeInstanceOf(NotesPathError);
    expect(await readFile(path.join(outside, "secret.md"), "utf8")).toBe("secret");
  });

  it("lists the reader's notes apart from the app's per-book files, and won't edit those", async () => {
    const book = { id: "c7a9708c8427667f67560c06eade4af41a47400d" as BookId, title: "Patterns", author: null, format: "pdf" as const };
    const highlight = { id: "aaaaaaaa-1111-4111-8111-111111111111", anchor: { kind: "pdf" as const, page: 1, start: 0, end: 5 }, quote: "Name the problem.", chapterTitle: "One", color: "amber" as const, createdAt: "2026-11-01T00:00:00.000Z" };
    await put("Patterns.md", renderVault(book, { highlights: [highlight], notes: [] }));
    await put("Reading log.md", "Read [[Patterns#^h-aaaaaaaa]] today. #reading");
    await put(".obsidian/hidden.md", "no");
    await put(".trash/old.md", "no");

    const index = await listNotes(dir);
    expect(index.notes.map((n) => n.path)).toEqual(["Reading log.md"]);
    expect(index.books).toEqual([{ path: "Patterns.md", title: "Patterns", bookId: book.id }]);
    expect(index.tags).toEqual(["reading"]);
    expect(Date.parse(index.listedAt)).toBeGreaterThan(0);

    await expect(openNote(dir, "Patterns.md")).rejects.toBeInstanceOf(GeneratedFileError);
    await expect(saveNote(dir, "Patterns.md", "edited", contentHash("x"))).rejects.toBeInstanceOf(GeneratedFileError);

    expect(await listHighlightBlocks(dir)).toEqual([{ target: "Patterns#^h-aaaaaaaa", bookTitle: "Patterns", quote: "Name the problem." }]);
    expect(await readEmbed(dir, "Patterns", "^h-aaaaaaaa", "Reading log.md")).toEqual({ path: "Patterns.md", text: "Name the problem.", bookId: book.id });
  });
});

describe("links between notes", () => {
  it("finds backlinks by title, path, alias and heading, but not inside code", async () => {
    await put("Target.md", "# Target");
    await put("a.md", "See [[Target]].");
    await put("b/c.md", "Also [[Target#Intro|this one]]");
    await put("d.md", "`[[Target]]` is code\n```\n[[Target]]\n```");
    await put("e.md", "[[Other]]");
    const found = await backlinks(dir, "Target.md");
    expect(found.map((b) => [b.path, b.context])).toEqual([
      ["a.md", "See [[Target]]."],
      ["b/c.md", "Also [[Target#Intro|this one]]"],
    ]);
  });

  it("embeds a heading's section or a whole note", async () => {
    await put("Doc.md", "intro\n## Steps\none\ntwo\n## Next\nlater");
    expect((await readEmbed(dir, "Doc", "Steps", "x.md"))?.text).toBe("one\ntwo");
    expect((await readEmbed(dir, "Doc", null, "x.md"))?.text).toContain("## Next");
    expect(await readEmbed(dir, "Missing", null, "x.md")).toBeNull();
  });
});

describe("pasted images", () => {
  it("go where the vault's attachment setting says", () => {
    expect(attachmentFolder(null, "a/Note.md")).toBe("attachments");
    expect(attachmentFolder("/", "a/Note.md")).toBe("");
    expect(attachmentFolder("./", "a/Note.md")).toBe("a");
    expect(attachmentFolder("./img", "a/Note.md")).toBe("a/img");
    expect(attachmentFolder("Assets/pics", "a/Note.md")).toBe("Assets/pics");
  });

  it("are saved under a new name with an Obsidian embed, following .obsidian/app.json", async () => {
    await put("Note.md", "");
    const png = new Uint8Array([137, 80, 78, 71]);
    const first = await saveImage(dir, "Note.md", "image/png", png, AT);
    expect(first).toEqual({ path: "attachments/Pasted image 20261124143205.png", link: "![[Pasted image 20261124143205.png]]" });
    const again = await saveImage(dir, "Note.md", "image/png", png, AT);
    expect(again.path).toBe("attachments/Pasted image 20261124143205 1.png");

    await put(".obsidian/app.json", JSON.stringify({ attachmentFolderPath: "./", useMarkdownLinks: true }));
    await put("sub/Note.md", "");
    expect(await saveImage(dir, "sub/Note.md", "image/png", png, AT)).toEqual({
      path: "sub/Pasted image 20261124143205.png",
      link: "![](sub/Pasted%20image%2020261124143205.png)",
    });
    await expect(saveImage(dir, "Note.md", "image/svg+xml", png, AT)).rejects.toBeInstanceOf(NotesPathError);
  });
});
