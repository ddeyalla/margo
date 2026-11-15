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
    expect(result.index[bookIdOf("a.epub")]).toEqual({ ...a, sha256: null, missingSince: null });
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
    const result = reconcile(seeded([a]), [moved(a, "renamed.epub")], { newId: counter() });
    expect(idsOf(result)).toEqual({ "renamed.epub": bookIdOf("a.epub") });
    expect(result.index[bookIdOf("a.epub")].relPath).toBe("renamed.epub");
    expect(Object.keys(result.index)).toHaveLength(1);
    expect(result.changed).toBe(true);
  });

  it("keeps the id of a book moved into another folder", () => {
    const a = file("a.epub");
    const b = file("b.pdf");
    const result = reconcile(seeded([a, b]), [moved(a, "Shelf/Deeper/a.epub"), b], { newId: counter() });
    expect(idsOf(result)).toEqual({ "Shelf/Deeper/a.epub": bookIdOf("a.epub"), "b.pdf": bookIdOf("b.pdf") });
  });

  it("gives a copy a new id and leaves the original its own", () => {
    const a = file("a.epub");
    const copy = file("a copy.epub", { size: a.size, mtimeMs: a.mtimeMs });
    const newId = counter();
    const expected = counter()();
    const result = reconcile(seeded([a]), [a, copy], { newId });
    expect(idsOf(result)).toEqual({ "a.epub": bookIdOf("a.epub"), "a copy.epub": expected });
    expect(result.index[expected]).toEqual({ ...copy, sha256: null, missingSince: null });
    expect(result.minted).toEqual([expected]);
  });

  it("follows the files when two books swap names", () => {
    const a = file("a.epub");
    const b = file("b.epub");
    const result = reconcile(seeded([a, b]), [moved(a, "b.epub"), moved(b, "a.epub")], { newId: counter() });
    expect(idsOf(result)).toEqual({ "b.epub": bookIdOf("a.epub"), "a.epub": bookIdOf("b.epub") });
    expect(result.index[bookIdOf("a.epub")].relPath).toBe("b.epub");
    expect(result.index[bookIdOf("b.epub")].relPath).toBe("a.epub");
  });

  it("gives a new book at a path vacated in the same scan a new id, not the moved book's", () => {
    const a = file("a.epub");
    const newcomer = file("a.epub");
    const expected = counter()();
    const result = reconcile(seeded([a]), [moved(a, "Shelf/a.epub"), newcomer], { newId: counter() });
    expect(idsOf(result)).toEqual({ "Shelf/a.epub": bookIdOf("a.epub"), "a.epub": expected });
  });

  it("gives a new book at a path vacated in an earlier scan a new id", () => {
    const a = file("a.epub");
    const afterMove = reconcile(seeded([a]), [moved(a, "Shelf/a.epub")], { newId: counter() }).index;
    const expected = counter()();
    const result = reconcile(afterMove, [moved(a, "Shelf/a.epub"), file("a.epub")], { newId: counter() });
    expect(idsOf(result)).toEqual({ "Shelf/a.epub": bookIdOf("a.epub"), "a.epub": expected });
  });

  it("keeps the id of a file replaced in place by an editor (new inode, same path)", () => {
    const a = file("a.epub");
    const saved = file("a.epub", { size: 2000, mtimeMs: a.mtimeMs + 1 });
    const index = { ...seeded([a]) };
    index[bookIdOf("a.epub")] = { ...index[bookIdOf("a.epub")], sha256: "0".repeat(64) };
    const result = reconcile(index, [saved], { newId: counter() });
    expect(idsOf(result)).toEqual({ "a.epub": bookIdOf("a.epub") });
    expect(result.index[bookIdOf("a.epub")]).toEqual({ ...saved, sha256: null, missingSince: null });
  });

  it("keeps the hash of a file whose size and mtime did not change", () => {
    const a = file("a.epub");
    const index = { ...seeded([a]) };
    index[bookIdOf("a.epub")] = { ...index[bookIdOf("a.epub")], sha256: "0".repeat(64) };
    const result = reconcile(index, [moved(a, "b.epub")], { newId: counter() });
    expect(result.index[bookIdOf("a.epub")].sha256).toBe("0".repeat(64));
  });

  it("keeps every id through a remount that changes every device number", () => {
    const a = file("a.epub");
    const b = file("Shelf/b.pdf");
    const result = reconcile(seeded([a, b]), [{ ...a, dev: "2" }, { ...b, dev: "2" }], { newId: counter() });
    expect(idsOf(result)).toEqual({ "a.epub": bookIdOf("a.epub"), "Shelf/b.pdf": bookIdOf("Shelf/b.pdf") });
    expect(result.index[bookIdOf("a.epub")].dev).toBe("2");
  });

  it("does not bind a file whose inode matches several entries", () => {
    const a = file("a.epub");
    const index = seeded([a, file("b.epub")]);
    index[bookIdOf("b.epub")] = { ...index[bookIdOf("b.epub")], ino: a.ino, dev: a.dev, size: a.size };
    const expected = counter()();
    const result = reconcile(index, [moved(a, "c.epub")], { newId: counter() });
    expect(idsOf(result)).toEqual({ "c.epub": expected });
    expect(result.index[bookIdOf("a.epub")].relPath).toBe("a.epub");
    expect(result.index[bookIdOf("b.epub")].relPath).toBe("b.epub");
  });

  it("does not bind an entry that several files match by inode, such as hard links", () => {
    const a = file("a.epub");
    const ids = counter();
    const [first, second] = [ids(), ids()];
    const result = reconcile(seeded([a]), [moved(a, "link one.epub"), moved(a, "link two.epub")], { newId: counter() });
    expect(idsOf(result)).toEqual({ "link one.epub": first, "link two.epub": second });
    expect(result.index[bookIdOf("a.epub")].relPath).toBe("a.epub");
  });

  it("leaves out a second path to a book it already matched, such as a hard link", () => {
    const a = file("a.epub");
    const index = seeded([a]);
    const result = reconcile(index, [a, moved(a, "link.epub")], { newId: counter() });
    expect(idsOf(result)).toEqual({ "a.epub": bookIdOf("a.epub") });
    expect(result.skipped.map(({ relPath }) => relPath)).toEqual(["link.epub"]);
    expect(result.index).toEqual(index);
    expect(result.changed).toBe(false);
  });

  it("keeps the id of a book seen at both ends of a move made during the scan", () => {
    const a = file("a.epub");
    const during = reconcile(seeded([a]), [a, moved(a, "Shelf/a.epub")], { newId: counter() });
    expect(idsOf(during)).toEqual({ "a.epub": bookIdOf("a.epub") });
    const after = reconcile(during.index, [moved(a, "Shelf/a.epub")], { newId: counter() });
    expect(idsOf(after)).toEqual({ "Shelf/a.epub": bookIdOf("a.epub") });
  });

  it("gives a new file at the path of a book deleted in an earlier scan a new id", () => {
    const a = file("a.epub");
    const b = file("b.epub");
    const afterDelete = reconcile(seeded([a, b]), [b], { newId: counter(), now: 5 }).index;
    const expected = counter()();
    const result = reconcile(afterDelete, [b, file("a.epub")], { newId: counter(), now: 9 });
    expect(idsOf(result)).toEqual({ "b.epub": bookIdOf("b.epub"), "a.epub": expected });
    expect(result.index[bookIdOf("a.epub")]).toEqual(afterDelete[bookIdOf("a.epub")]);
    expect(result.orphans).toEqual([bookIdOf("a.epub")]);
  });

  it("gives a file renamed onto a deleted book's path the id it already had", () => {
    const a = file("a.epub");
    const b = file("b.epub");
    const result = reconcile(seeded([a, b]), [moved(a, "b.epub")], { newId: counter() });
    expect(idsOf(result)).toEqual({ "b.epub": bookIdOf("a.epub") });
    expect(result.orphans).toEqual([bookIdOf("b.epub")]);
  });

  it("gives a new file that reuses a deleted book's inode number a new id", () => {
    const a = file("a.epub");
    const afterDelete = reconcile(seeded([a, file("b.epub")]), [file("b.epub")], { newId: counter() }).index;
    const expected = counter()();
    const reused = file("c.epub", { ino: a.ino, dev: a.dev, size: a.size, mtimeMs: a.mtimeMs + 60_000 });
    const result = reconcile(afterDelete, [reused], { newId: counter() });
    expect(idsOf(result)).toEqual({ "c.epub": expected });
  });

  it("finds a book missing for several scans again by its inode", () => {
    const a = file("a.epub");
    const b = file("b.epub");
    const gone = reconcile(reconcile(seeded([a, b]), [b], { newId: counter(), now: 5 }).index, [b], { newId: counter(), now: 9 }).index;
    const result = reconcile(gone, [b, moved(a, "Shelf/a.epub")], { newId: counter() });
    expect(idsOf(result)).toEqual({ "b.epub": bookIdOf("b.epub"), "Shelf/a.epub": bookIdOf("a.epub") });
    expect(result.index[bookIdOf("a.epub")].missingSince).toBeNull();
    expect(result.orphans).toEqual([]);
  });

  it("leaves the index alone when the scan finds no books", () => {
    const index = seeded([file("a.epub"), file("b.pdf")]);
    const result = reconcile(index, [], { newId: counter() });
    expect(result).toEqual({ index, books: [], skipped: [], orphans: [], minted: [], wantsHash: [], changed: false });
  });

  it("does not seed from an empty scan, so books found later still get their old ids", () => {
    const empty = reconcile(null, []);
    expect(empty.changed).toBe(false);
    expect(idsOf(reconcile(empty.index, [file("a.epub")]))).toEqual({ "a.epub": bookIdOf("a.epub") });
  });

  it("marks an orphan missing from the first scan that does not find it", () => {
    const a = file("a.epub");
    const b = file("b.pdf");
    const index = seeded([a, b]);
    const first = reconcile(index, [b], { newId: counter(), now: 5 });
    expect(first.index[bookIdOf("a.epub")]).toEqual({ ...index[bookIdOf("a.epub")], missingSince: 5 });
    expect(first.orphans).toEqual([bookIdOf("a.epub")]);
    expect(first.changed).toBe(true);
    const second = reconcile(first.index, [b], { newId: counter(), now: 9 });
    expect(second.index).toEqual(first.index);
    expect(second.changed).toBe(false);
    expect(reconcile(second.index, [a, b], { newId: counter() }).index).toEqual(index);
  });

  it("never hands out an id already in the index", () => {
    const a = file("a.epub");
    const index = seeded([a]);
    const ids = [bookIdOf("a.epub"), "e".repeat(40) as BookId];
    const result = reconcile(index, [a, file("b.epub")], { newId: () => ids.shift()! });
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

describe("reconcile by content hash", () => {
  const SHA = "a".repeat(64);
  const OTHER = "b".repeat(64);

  /** An index of `files` in which each named path's entry already has the given hash. */
  const hashedIndex = (files: FileStat[], shas: Record<string, string>): LibraryIndex => {
    const index = { ...seeded(files) };
    for (const [relPath, sha256] of Object.entries(shas)) index[bookIdOf(relPath)] = { ...index[bookIdOf(relPath)], sha256 };
    return index;
  };

  /** Reconciles as a scan does: once, then again with the hashes of whatever that first pass asked for. */
  const twoPass = (index: LibraryIndex, files: FileStat[], shas: Record<string, string>, now = 7) => {
    const first = reconcile(index, files, { newId: counter(), now });
    const hashes = new Map(first.wantsHash.map(({ relPath }) => [relPath, shas[relPath]]));
    return { first, result: reconcile(index, files, { newId: counter(), now, hashes }) };
  };

  it("keeps the id of a book moved to another volume (new device and inode, same bytes)", () => {
    const a = file("a.epub");
    const b = file("b.pdf", { size: 2000 });
    const index = hashedIndex([a, b], { "a.epub": SHA });
    const elsewhere = file("Other Drive/a.epub", { dev: "9", mtimeMs: a.mtimeMs + 5 });
    const { first, result } = twoPass(index, [elsewhere, b], { "Other Drive/a.epub": SHA });
    expect(first.wantsHash).toEqual([elsewhere]);
    expect(idsOf(result)).toEqual({ "Other Drive/a.epub": bookIdOf("a.epub"), "b.pdf": bookIdOf("b.pdf") });
    expect(result.index[bookIdOf("a.epub")]).toEqual({ ...elsewhere, sha256: SHA, missingSince: null });
    expect(result.minted).toEqual([]);
    expect(result.orphans).toEqual([]);
  });

  it("keeps the id of a book saved as a new file at a new path", () => {
    const a = file("a.epub");
    const index = hashedIndex([a], { "a.epub": SHA });
    const saved = file("Shelf/a (saved).epub", { mtimeMs: a.mtimeMs + 60_000 });
    const { result } = twoPass(index, [saved], { "Shelf/a (saved).epub": SHA });
    expect(idsOf(result)).toEqual({ "Shelf/a (saved).epub": bookIdOf("a.epub") });
  });

  it("finds a book missing for several scans again by its hash", () => {
    const a = file("a.epub");
    const b = file("b.pdf", { size: 2000 });
    const gone = reconcile(hashedIndex([a, b], { "a.epub": SHA }), [b], { newId: counter(), now: 5 }).index;
    expect(gone[bookIdOf("a.epub")].missingSince).toBe(5);
    const { result } = twoPass(gone, [b, file("back.epub")], { "back.epub": SHA });
    expect(idsOf(result)).toEqual({ "b.pdf": bookIdOf("b.pdf"), "back.epub": bookIdOf("a.epub") });
    expect(result.index[bookIdOf("a.epub")].missingSince).toBeNull();
  });

  it("binds nothing when two identical files match one orphan", () => {
    const index = hashedIndex([file("a.epub")], { "a.epub": SHA });
    const one = file("one.epub");
    const two = file("two.epub");
    const { first, result } = twoPass(index, [one, two], { "one.epub": SHA, "two.epub": SHA });
    expect(first.wantsHash).toEqual([one, two]);
    const ids = counter();
    expect(idsOf(result)).toEqual({ "one.epub": ids(), "two.epub": ids() });
    expect(result.orphans).toEqual([bookIdOf("a.epub")]);
    expect(result.index[bookIdOf("a.epub")]).toEqual({ ...index[bookIdOf("a.epub")], missingSince: 7 });
  });

  it("binds nothing when one file matches two orphans with the same bytes", () => {
    const index = hashedIndex([file("a.epub"), file("b.epub")], { "a.epub": SHA, "b.epub": SHA });
    const { result } = twoPass(index, [file("moved.epub")], { "moved.epub": SHA });
    expect(idsOf(result)).toEqual({ "moved.epub": counter()() });
    expect(result.orphans.sort()).toEqual([bookIdOf("a.epub"), bookIdOf("b.epub")].sort());
  });

  it("leaves a book moved and edited to the same size orphaned and gives the file a new id", () => {
    const index = hashedIndex([file("a.epub")], { "a.epub": SHA });
    const edited = file("Shelf/a.epub");
    const { first, result } = twoPass(index, [edited], { "Shelf/a.epub": OTHER });
    expect(first.wantsHash).toEqual([edited]);
    const expected = counter()();
    expect(idsOf(result)).toEqual({ "Shelf/a.epub": expected });
    expect(result.index[expected].sha256).toBe(OTHER);
    expect(result.orphans).toEqual([bookIdOf("a.epub")]);
  });

  it("asks for no hash of a file whose size no hashed orphan has", () => {
    const a = file("a.epub");
    const result = reconcile(hashedIndex([a], { "a.epub": SHA }), [file("Shelf/a.epub", { size: a.size + 1 })], { newId: counter() });
    expect(result.wantsHash).toEqual([]);
    expect(result.orphans).toEqual([bookIdOf("a.epub")]);
  });

  it("asks for no hash of a file that only an orphan without a hash shares a size with", () => {
    const result = reconcile(seeded([file("a.epub")]), [file("Shelf/a.epub")], { newId: counter() });
    expect(result.wantsHash).toEqual([]);
  });

  it("asks for no hash when every file is matched by inode or path", () => {
    const a = file("a.epub");
    const b = file("b.epub");
    const result = reconcile(hashedIndex([a, b], { "a.epub": SHA, "b.epub": SHA }), [moved(a, "c.epub"), b], { newId: counter() });
    expect(result.wantsHash).toEqual([]);
    expect(result.changed).toBe(true);
  });

  it("asks for no hash of a second path to a file it already matched", () => {
    const a = file("a.epub");
    const result = reconcile(hashedIndex([a, file("b.epub")], { "b.epub": SHA }), [a, moved(a, "link.epub")], { newId: counter() });
    expect(result.skipped.map(({ relPath }) => relPath)).toEqual(["link.epub"]);
    expect(result.wantsHash).toEqual([]);
  });

  it("never offers an entry that inode or path already bound to the hash matcher", () => {
    const a = file("a.epub");
    const { first, result } = twoPass(hashedIndex([a], { "a.epub": SHA }), [a, file("copy.epub")], { "copy.epub": SHA });
    expect(first.wantsHash).toEqual([]);
    expect(idsOf(result)).toEqual({ "a.epub": bookIdOf("a.epub"), "copy.epub": counter()() });
  });
});
