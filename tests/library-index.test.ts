import { describe, expect, it } from "vitest";
import { bookIdOf, reconcile, type FileStat, type LibraryIndex } from "@/lib/server/library-index";
import type { BookId } from "@/lib/shared/types";

let inode = 100;
const file = (relPath: string, over: Partial<FileStat> = {}): FileStat => ({
  relPath,
  size: 1000,
  mtimeMs: 1_700_000_000_000,
  ino: String(inode++),
  dev: "1",
  ...over,
});

/** Numbered ids, so a test can say which new id a file must get. */
const counter = () => {
  let n = 0;
  return () => (n++).toString(16).padStart(40, "f") as BookId;
};

const idsOf = (result: { books: { id: BookId; file: FileStat }[] }) =>
  Object.fromEntries(result.books.map(({ id, file }) => [file.relPath, id]));

/** Seeds an index from `files`, as the first scan of an existing library does. */
const seeded = (files: FileStat[]): LibraryIndex => reconcile(null, files).index;

const moved = (from: FileStat, relPath: string): FileStat => ({ ...from, relPath });

describe("reconcile", () => {
  it("seeds every file with the id its path gave it before ids were stored", () => {
    const a = file("a.epub");
    const b = file("Shelf/b.pdf");
    const result = reconcile(null, [a, b]);
    expect(idsOf(result)).toEqual({ "a.epub": bookIdOf("a.epub"), "Shelf/b.pdf": bookIdOf("Shelf/b.pdf") });
    expect(result.changed).toBe(true);
    expect(result.index[bookIdOf("a.epub")]).toEqual({ ...a, sha256: null });
  });

  it("seeds from an index that exists but is empty", () => {
    expect(idsOf(reconcile({}, [file("a.epub")]))).toEqual({ "a.epub": bookIdOf("a.epub") });
  });

  it("changes nothing on a second scan of the same files", () => {
    const files = [file("a.epub"), file("b.pdf")];
    const index = seeded(files);
    const result = reconcile(index, files);
    expect(result.changed).toBe(false);
    expect(result.index).toEqual(index);
    expect(idsOf(result)).toEqual({ "a.epub": bookIdOf("a.epub"), "b.pdf": bookIdOf("b.pdf") });
  });

  it("keeps a renamed book's id", () => {
    const a = file("a.epub");
    const result = reconcile(seeded([a]), [moved(a, "renamed.epub")], counter());
    expect(idsOf(result)).toEqual({ "renamed.epub": bookIdOf("a.epub") });
    expect(result.index[bookIdOf("a.epub")].relPath).toBe("renamed.epub");
    expect(Object.keys(result.index)).toHaveLength(1);
    expect(result.changed).toBe(true);
  });

  it("keeps the id of a book moved into another folder", () => {
    const a = file("a.epub");
    const b = file("b.pdf");
    const result = reconcile(seeded([a, b]), [moved(a, "Shelf/Deeper/a.epub"), b], counter());
    expect(idsOf(result)).toEqual({ "Shelf/Deeper/a.epub": bookIdOf("a.epub"), "b.pdf": bookIdOf("b.pdf") });
  });

  it("gives a copy a new id and leaves the original its own", () => {
    const a = file("a.epub");
    const copy = file("a copy.epub", { size: a.size, mtimeMs: a.mtimeMs });
    const newId = counter();
    const expected = counter()();
    const result = reconcile(seeded([a]), [a, copy], newId);
    expect(idsOf(result)).toEqual({ "a.epub": bookIdOf("a.epub"), "a copy.epub": expected });
    expect(result.index[expected]).toEqual({ ...copy, sha256: null });
  });

  it("follows the files when two books swap names", () => {
    const a = file("a.epub");
    const b = file("b.epub");
    const result = reconcile(seeded([a, b]), [moved(a, "b.epub"), moved(b, "a.epub")], counter());
    expect(idsOf(result)).toEqual({ "b.epub": bookIdOf("a.epub"), "a.epub": bookIdOf("b.epub") });
    expect(result.index[bookIdOf("a.epub")].relPath).toBe("b.epub");
    expect(result.index[bookIdOf("b.epub")].relPath).toBe("a.epub");
  });

  it("gives a new book at a path vacated in the same scan a new id, not the moved book's", () => {
    const a = file("a.epub");
    const newcomer = file("a.epub");
    const expected = counter()();
    const result = reconcile(seeded([a]), [moved(a, "Shelf/a.epub"), newcomer], counter());
    expect(idsOf(result)).toEqual({ "Shelf/a.epub": bookIdOf("a.epub"), "a.epub": expected });
  });

  it("gives a new book at a path vacated in an earlier scan a new id", () => {
    const a = file("a.epub");
    const afterMove = reconcile(seeded([a]), [moved(a, "Shelf/a.epub")], counter()).index;
    const expected = counter()();
    const result = reconcile(afterMove, [moved(a, "Shelf/a.epub"), file("a.epub")], counter());
    expect(idsOf(result)).toEqual({ "Shelf/a.epub": bookIdOf("a.epub"), "a.epub": expected });
  });

  it("keeps the id of a file replaced in place by an editor (new inode, same path)", () => {
    const a = file("a.epub");
    const saved = file("a.epub", { size: 2000, mtimeMs: a.mtimeMs + 1 });
    const index = { ...seeded([a]) };
    index[bookIdOf("a.epub")] = { ...index[bookIdOf("a.epub")], sha256: "0".repeat(64) };
    const result = reconcile(index, [saved], counter());
    expect(idsOf(result)).toEqual({ "a.epub": bookIdOf("a.epub") });
    expect(result.index[bookIdOf("a.epub")]).toEqual({ ...saved, sha256: null });
  });

  it("keeps the hash of a file whose size and mtime did not change", () => {
    const a = file("a.epub");
    const index = { ...seeded([a]) };
    index[bookIdOf("a.epub")] = { ...index[bookIdOf("a.epub")], sha256: "0".repeat(64) };
    const result = reconcile(index, [moved(a, "b.epub")], counter());
    expect(result.index[bookIdOf("a.epub")].sha256).toBe("0".repeat(64));
  });

  it("keeps every id through a remount that changes every device number", () => {
    const a = file("a.epub");
    const b = file("Shelf/b.pdf");
    const result = reconcile(seeded([a, b]), [{ ...a, dev: "2" }, { ...b, dev: "2" }], counter());
    expect(idsOf(result)).toEqual({ "a.epub": bookIdOf("a.epub"), "Shelf/b.pdf": bookIdOf("Shelf/b.pdf") });
    expect(result.index[bookIdOf("a.epub")].dev).toBe("2");
  });

  it("does not bind a file whose inode matches several entries", () => {
    const a = file("a.epub");
    const index = seeded([a, file("b.epub")]);
    index[bookIdOf("b.epub")] = { ...index[bookIdOf("b.epub")], ino: a.ino, dev: a.dev, size: a.size };
    const expected = counter()();
    const result = reconcile(index, [moved(a, "c.epub")], counter());
    expect(idsOf(result)).toEqual({ "c.epub": expected });
    expect(result.index[bookIdOf("a.epub")].relPath).toBe("a.epub");
    expect(result.index[bookIdOf("b.epub")].relPath).toBe("b.epub");
  });

  it("does not bind an entry that several files match by inode, such as hard links", () => {
    const a = file("a.epub");
    const ids = counter();
    const [first, second] = [ids(), ids()];
    const result = reconcile(seeded([a]), [moved(a, "link one.epub"), moved(a, "link two.epub")], counter());
    expect(idsOf(result)).toEqual({ "link one.epub": first, "link two.epub": second });
    expect(result.index[bookIdOf("a.epub")].relPath).toBe("a.epub");
  });

  it("leaves out a second path to a book it already matched, such as a hard link", () => {
    const a = file("a.epub");
    const index = seeded([a]);
    const result = reconcile(index, [a, moved(a, "link.epub")], counter());
    expect(idsOf(result)).toEqual({ "a.epub": bookIdOf("a.epub") });
    expect(result.index).toEqual(index);
    expect(result.changed).toBe(false);
  });

  it("keeps the id of a book seen at both ends of a move made during the scan", () => {
    const a = file("a.epub");
    const during = reconcile(seeded([a]), [a, moved(a, "Shelf/a.epub")], counter());
    expect(idsOf(during)).toEqual({ "a.epub": bookIdOf("a.epub") });
    const after = reconcile(during.index, [moved(a, "Shelf/a.epub")], counter());
    expect(idsOf(after)).toEqual({ "Shelf/a.epub": bookIdOf("a.epub") });
  });

  it("does not bind a path that two unmatched entries both claim", () => {
    const a = file("a.epub");
    const b = file("b.epub");
    /* b is deleted and a renamed onto its path: both entries now name b.epub. */
    const both = reconcile(seeded([a, b]), [moved(a, "b.epub")], counter()).index;
    expect(both[bookIdOf("a.epub")].relPath).toBe("b.epub");
    expect(both[bookIdOf("b.epub")].relPath).toBe("b.epub");
    const expected = counter()();
    const result = reconcile(both, [file("b.epub")], counter());
    expect(idsOf(result)).toEqual({ "b.epub": expected });
  });

  it("leaves the index alone when the scan finds no books", () => {
    const index = seeded([file("a.epub"), file("b.pdf")]);
    const result = reconcile(index, [], counter());
    expect(result).toEqual({ index, books: [], changed: false });
  });

  it("does not seed from an empty scan, so books found later still get their old ids", () => {
    const empty = reconcile(null, []);
    expect(empty.changed).toBe(false);
    expect(idsOf(reconcile(empty.index, [file("a.epub")]))).toEqual({ "a.epub": bookIdOf("a.epub") });
  });

  it("keeps an orphan's entry unchanged", () => {
    const a = file("a.epub");
    const b = file("b.pdf");
    const index = seeded([a, b]);
    const result = reconcile(index, [b], counter());
    expect(result.index[bookIdOf("a.epub")]).toEqual(index[bookIdOf("a.epub")]);
    expect(result.changed).toBe(false);
  });

  it("never hands out an id already in the index", () => {
    const a = file("a.epub");
    const index = seeded([a]);
    const ids = [bookIdOf("a.epub"), "e".repeat(40) as BookId];
    const result = reconcile(index, [a, file("b.epub")], () => ids.shift()!);
    expect(idsOf(result)).toEqual({ "a.epub": bookIdOf("a.epub"), "b.epub": "e".repeat(40) });
  });

  it("gives new books random 40-hex ids by default", () => {
    const result = reconcile(seeded([file("a.epub")]), [file("b.epub"), file("c.epub")]);
    const [b, c] = result.books.map(({ id }) => id);
    expect(b).toMatch(/^[0-9a-f]{40}$/);
    expect(b).not.toBe(c);
    expect(b).not.toBe(bookIdOf("b.epub"));
  });
});
