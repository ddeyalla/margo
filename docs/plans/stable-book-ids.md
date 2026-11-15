# Stable book ids

## Problem

A book's id is `sha1(relPath)` (`lib/server/library.ts`), and everything saved about a book is keyed by that id:
the state file `<id>.json`, `<id>.position.json`, `covers/<id>.*`, `attachments/<id>/`, and the `bookId` in its
vault note's frontmatter. Renaming a file or moving it to another folder gives it a new id, so it opens as a new
book and its highlights, notes, cards, chats and place are left behind under the old id.

## Goal

Moving or renaming a book inside the books folder keeps everything attached to it, without touching the book
files and without changing any existing book's id.

## Design

### The id is assigned once; the path is a property of it

- A new index, `DATA_DIR/library.json`, maps each id to what was last seen of its file:
  `{ relPath, size, mtimeMs, ino, dev, sha256 | null }`. It is the only place that turns a file into an id.
- Written with the queued atomic helpers in `lib/server/store.ts` (`serialized` + `writeFileAtomic`), so two
  scans can never interleave writes or leave a torn file.
- **Seeding:** with no index, every file found gets `sha1(relPath)`, the id it has today. Existing data keeps
  working with no migration.
- **New books get a random 40-hex id**, not a path hash. A path hash would hand a new book at an old path the
  data of the book that used to live there.
- `isBookId` and the id format stay the same, so routes, the vault and the client don't change.

### Reconcile after the whole scan, never per file

A scan lists files, then reconciles them against the index in one pass:

1. **Same path:** keeps its id; the stored size/mtime/inode are refreshed. No file reads. This is every scan in
   normal use.
2. **Unknown path:** matched against *orphans* (index entries whose path was not found in this scan), strongest
   signal first:
   1. same `dev` + `ino` + `size` — a rename or a move on the same volume (Finder, `mv`) keeps the inode;
   2. same `sha256` — a copy to another volume, a re-download, or an app that saves by writing a new file.
      Only files whose size equals some orphan's size are hashed, so this costs nothing when nothing moved.
3. **Only one-to-one matches bind.** A file matching several orphans, or an orphan matched by several files, is
   left alone: the files become new books and the orphans stay orphans for the missing-books list. No guessing.
4. Anything unmatched becomes a new book with a random id.

### Hashes are computed once, off the request path

- A book's `sha256` is streamed in a background task after a scan finds it without one (or with a changed
  size/mtime), one file at a time, and written to the index. Matching never waits on it; until it lands, the
  inode still covers renames and moves on the same volume.
- An edit in place keeps its path, so it keeps its id; the hash is simply recomputed.

### Never lose data on a bad scan

- An unreadable or missing books folder already throws (`libraryProblem`); the index is not touched.
- A scan that finds **zero** books while the index has entries (an empty mount point, an unmounted drive's
  folder) does not reconcile or write the index.
- The index never forgets a book on its own. An orphan keeps its data until the reader relinks or forgets it.
- If `library.json` is lost, re-seeding gives every file at its original path its original id back; anything that
  had moved shows in the missing-books list (its state file has no index entry) and can be relinked by hand.

### Missing books

The library lists books that have saved data but no file: index orphans, plus state files with no index entry.
Each has **Find file…** (pick a book in the books folder; it takes the old id) and **Forget** (deletes its state,
position, cover and attachments after confirming; vault notes are the reader's files and stay).

### Security is unchanged

`findBook` still resolves only ids the scan produced to paths inside the books folder. Relink accepts only a path
the scan found.

## Slices

Each slice ships on its own, passes `tsc`, `eslint`, `vitest`, is checked live on a copy of the test data, and gets
a thermo-nuclear code-quality review before the next starts.

1. **Index, seeding, path + inode matching, scan safety.** `library.json`, random ids for new books, the
   one-to-one rule, the zero-books guard, concurrency through the store queue. Tests: seed keeps every existing
   id; rename; move to another folder; copy (new id, original keeps its own); two files swapping names; a new
   book at a vacated path gets a new id; zero-book scan leaves the index alone; concurrent scans.
2. **Content hashes.** Background hashing, size-filtered hash matching for unknown paths. Tests: move to another
   volume (new inode, same bytes); save-as-new-file; two identical files (ambiguous, nothing binds); moved and
   edited (no match, stays orphaned).
3. **Missing books.** Listing, relink and forget routes, and the library UI. Tests: relink moves the data to the
   chosen file; relinking to a file whose current id already has saved data is refused (its new, empty id is simply dropped otherwise); forget removes every per-id file and
   nothing else.

## Status

- [x] Slice 1
- [ ] Slice 2
- [ ] Slice 3
