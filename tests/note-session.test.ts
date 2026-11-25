import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteSession, SAVE_DELAY_MS, type NoteApi, type NoteEvents } from "@/components/notes/noteSession";
import { noteHash, openNote, saveNote } from "@/lib/server/notes";

/* The editor's side of the disk-conflict rule, run against the real notes folder code in a temp folder. */

let dir: string;
let api: NoteApi;
let events: NoteEvents & { log: string[] };

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "rigg-session-"));
  api = {
    save: (p, text, hash) => saveNote(dir, p, text, hash),
    change: async (p, since) => {
      const hash = await noteHash(dir, p);
      return hash === since ? undefined : hash;
    },
    open: (p) => openNote(dir, p),
  };
  const log: string[] = [];
  events = {
    log,
    replace: (text) => log.push(`replace:${text}`),
    status: (status) => log.push(`status:${status}`),
    conflict: (copy, deleted) => log.push(`conflict:${copy}:${deleted}`),
    gone: () => log.push("gone"),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

const open = async (name: string, text: string) => {
  await writeFile(path.join(dir, name), text);
  const opened = (await openNote(dir, name))!;
  return new NoteSession(name, opened, api, events);
};
const read = (name: string) => readFile(path.join(dir, name), "utf8");

describe("an open note", () => {
  it("saves edits a moment after typing stops", async () => {
    vi.useFakeTimers();
    const session = await open("A.md", "one");
    session.edit("one two");
    expect(await read("A.md")).toBe("one");
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
    vi.useRealTimers();
    await session.flush();
    expect(await read("A.md")).toBe("one two");
    expect(session.dirty).toBe(false);
  });

  it("shows a change made in Obsidian when nothing typed here is unsaved", async () => {
    const session = await open("A.md", "one");
    await writeFile(path.join(dir, "A.md"), "edited in Obsidian");
    await session.checkDisk();
    expect(events.log).toContain("replace:edited in Obsidian");
    session.edit("edited in Obsidian, then here");
    await session.flush();
    expect(await read("A.md")).toBe("edited in Obsidian, then here");
  });

  it("never replaces unsaved text with the disk's: the save keeps both instead", async () => {
    const session = await open("A.md", "one");
    session.edit("typed here");
    await writeFile(path.join(dir, "A.md"), "edited in Obsidian");
    await session.checkDisk();
    expect(events.log.some((e) => e.startsWith("replace:"))).toBe(false);

    await session.flush();
    expect(await read("A.md")).toBe("edited in Obsidian");
    const copy = (await readdir(dir)).find((name) => name.includes("(conflict"))!;
    expect(await read(copy)).toBe("typed here");
    expect(events.log).toContain("replace:edited in Obsidian");
    expect(events.log).toContain(`conflict:${copy}:false`);
    /* The disk version is now the base: the next edit saves over it normally. */
    session.edit("edited in Obsidian, kept");
    await session.flush();
    expect(await read("A.md")).toBe("edited in Obsidian, kept");
  });

  it("puts words typed while a conflicting save was out into the copy as well", async () => {
    const session = await open("A.md", "one");
    session.edit("first words");
    await writeFile(path.join(dir, "A.md"), "theirs");
    const saving = session.flush();
    session.edit("first words and more");
    await saving;
    await session.flush();
    const copy = (await readdir(dir)).find((name) => name.includes("(conflict"))!;
    expect(await read(copy)).toBe("first words and more");
    expect(await read("A.md")).toBe("theirs");
  });

  it("keeps the text in a copy, and stops saving, when the file was deleted with unsaved edits", async () => {
    const session = await open("A.md", "one");
    session.edit("unsaved");
    await rm(path.join(dir, "A.md"));
    await session.flush();
    const names = await readdir(dir);
    expect(names).toHaveLength(1);
    expect(await read(names[0])).toBe("unsaved");
    expect(events.log).toContain(`conflict:${names[0]}:true`);
    session.edit("more");
    await session.flush();
    expect(await readdir(dir)).toEqual(names);
  });

  it("lets a deleted note go when nothing was unsaved", async () => {
    const session = await open("A.md", "one");
    await rm(path.join(dir, "A.md"));
    await session.checkDisk();
    expect(events.log).toContain("gone");
    expect(await readdir(dir)).toEqual([]);
  });
});
