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

- A new index, `DATA_DIR/library.json` (`{ version: 1, books }`), maps each id to what was last seen of its file:
  `{ relPath, size, mtimeMs, ino, dev, sha256 | null, missingSince | null }`. It is the only place that turns a
  file into an id.
- The whole scan (listing the books folder, reading the index, reconciling, writing) runs inside one
  `serialized(library.json)` task from `lib/server/store.ts`, so a listing taken earlier can never be applied
  after one taken later. The index is written with `writeFileAtomic` in the store's JSON format, and only when
  an entry changed, so a steady scan writes nothing.
- **Strict read:** a missing `library.json` means "no index yet". Anything else that is not a version 1 index
  with well-typed entries (unparsable, wrong version, wrong shape, unreadable) throws `LibraryIndexError`, and
  the library and book pages say the saved library index in the data folder can't be read and nothing was
  changed. It is never re-seeded over, because that would hand out ids again.
- **Seeding:** with no index, every file found gets `sha1(relPath)`, the id it has today. Existing data keeps
  working with no migration.
- **New books get a random 40-hex id**, not a path hash. A path hash would hand a new book at an old path the
  data of the book that used to live there.
- `isBookId` and the id format stay the same, so routes, the vault and the client don't change.

### Reconcile after the whole scan, never per file

`reconcile` is pure: it takes the index, the scan and `{ newId, now, hashes }` (all optional), and returns the
new index with the books, the skipped paths, the orphans (entries no file was bound to) and the minted ids. It
runs a list of matchers in order; each binds only keys shared by exactly one still-unbound file and exactly one
still-unbound entry (`bindOneToOne`), so anything ambiguous falls through and nothing is guessed.

1. **Same inode:** `dev:ino:size:mtimeMs`. Renames, moves on one volume (Finder, `mv`) and two files swapping
   names keep their ids, and a moved book keeps its id even when a new file lands at its old path. mtime is in
   the key because exFAT and ext4 reuse inode numbers, and a new file on a dead book's inode would otherwise
   take that book's data.
2. **Same path, for entries the previous scan found** (`missingSince === null` before this scan): editors that
   save by writing a new file, and a volume remounted with new device numbers.
3. **Same hash:** a file's sha256 taken this scan against any unbound entry's, present or missing. See below.
4. Anything left is minted a random id, except **another path to a file already bound this scan** (a hard link,
   or a book seen at both ends of a move made during the scan). That path is skipped and logged once with a
   warning, because an id minted for it would share the book's inode and strand the book's data next scan.

**`missingSince`:** an entry not bound in a non-empty scan gets `missingSince = now` if it was null and keeps
its first timestamp otherwise; a bound entry gets null. A book that was already missing is matched only by
inode or hash, or relinked by hand, never by path: a new file at a dead book's old path is a new book.

### Hashes

- **During a scan, two pure passes.** `reconcile` takes an optional `hashes` map (relPath to sha256) and
  returns `wantsHash`: the files about to be minted that are the size of a still-unbound entry with a known
  hash. The scan reconciles once with no hashes; if `wantsHash` is not empty it streams SHA-256 for exactly
  those files and reconciles the same index again with them. The rule for which files are worth hashing
  lives next to the matchers, so the I/O layer never re-derives what would be minted. Sizes filter this, so
  a scan in which nothing moved reads no book bytes. So a move to another volume (new inode, same bytes) or
  a save as a new file at a new path binds on the scan that finds it, as long as the orphan was hashed
  earlier.
- A hash taken during a scan is stored on the file's entry, bound or minted, so it is not taken again.
- **In the background, after any index change** that leaves a present book without a hash (new, or with a
  changed size/mtime), `backfillHashes` hashes those books off the request path. One run per library at a
  time, tracked on globalThis like the scan cache.
  - **Batched.** The run reads the index once inside the queue and takes every entry that needs a hash. It
    hashes them one at a time outside the queue, each only if the file's stat is the same before and after
    reading it, and saves them every 25 hashes or about a second, whichever comes first: one queued read,
    each hash set only if its entry still has the relPath, size, mtime, inode and device that were hashed and
    no hash, one write. A fresh library of N books costs about N/25 index writes, not N. When the list is
    done the run looks again inside the queue and ends inside that same empty look, so a scan that adds an
    unhashed book after it starts a new run.
  - **Stale files end the run.** A file that vanished or changed while it was read is left for the next
    scan to resync; looking again before that would pick the same entry forever. The run finishes the list,
    saves what it has and stops; the next scan starts a fresh one.
  - **Failure record.** A present file that cannot be read (permissions, I/O errors) is recorded for the
    process's lifetime on globalThis, per library, as `id:size:mtimeMs`. It is not tried again or logged
    again until its size or mtime changes. A vanished file is not recorded, because a remounted drive brings
    it back with the same size and mtime. One `needsHash` rule decides both whether a change starts a run
    and what a run picks.
  - Errors never reach a scan.
- **One mutation path.** `updateIndex(root, dataDir, change)` is the only code that writes `library.json`:
  inside `serialized(library.json)` it strict-reads the index, applies `change`, writes only if it reports a
  change, starts the background run if `needsHash` finds work (written or not, because a restart leaves an
  unchanged index with unhashed books), and clears the library's cached scan when the change asks. The scan
  (with its folder walk inside the same task) and each batch save go through it, and slice 3's `rebind` will
  too.
- A moved book whose orphan had no hash yet becomes a new book and its orphan is relinked by hand in slice 3.

### Never lose data on a bad scan

- An unreadable or missing books folder already throws (`libraryProblem`); the index is not touched.
- An unreadable index throws `LibraryIndexError`; nothing is written.
- A scan that finds **zero** books while the index has entries (an empty mount point, an unmounted drive's
  folder) does not reconcile, mark anything missing or write the index.
- The index never forgets a book on its own. An orphan keeps its data until the reader relinks or forgets it.
- If `library.json` is lost, re-seeding gives every file at its original path its original id back; anything that
  had moved shows in the missing-books list (its state file has no index entry) and can be relinked by hand.

### Known limit

If, between two scans, a book is moved to another device inside the books folder **and** a different file
lands at its old path, the path matcher gives the old id to the new file: the entry was present last scan and
the inode no longer matches, so path is the strongest signal left. A move on the same device is fine, because
the inode matcher binds the moved book first. A possible fix, not implemented: offer path-only bindings whose
size or mtime changed to the hash pass as well, so the moved book's bytes can claim its id before the path
does.

### Missing books

The library lists books that have saved data but no file: index orphans, plus state files with no index entry.
Each has **Find file…** (pick a book in the books folder; it takes the old id through `rebind(oldId, file)`,
defined once in slice 3 and used for every hand relink) and **Forget** (deletes its state,
position, cover and attachments after confirming; vault notes are the reader's files and stay).

### Security is unchanged

`findBook` still resolves only ids the scan produced to paths inside the books folder. Relink accepts only a path
the scan found.

## Slices

Each slice ships on its own, passes `tsc`, `eslint`, `vitest`, is checked live on a copy of the test data, and gets
a thermo-nuclear code-quality review before the next starts.

1. **Index, seeding, path + inode matching, scan safety.** `library.json`, random ids for new books, the
   one-to-one rule, `missingSince`, the strict index read, hard-link skipping, the zero-books guard, the whole
   scan inside the store queue. Tests: seed keeps every existing
   id; rename; move to another folder; copy (new id, original keeps its own); two files swapping names; a new
   book at a vacated path gets a new id; zero-book scan leaves the index alone; concurrent scans.
2. **Content hashes.** Background hashing, and synchronous size-filtered hashing of unknown-path files as the
   third matcher. Tests: move to another
   volume (new inode, same bytes); save-as-new-file; two identical files (ambiguous, nothing binds); moved and
   edited (no match, stays orphaned).
3. **Missing books.** Listing, relink (through one `rebind(oldId, file)`) and forget routes, and the library UI. Tests: relink moves the data to the
   chosen file; relinking to a file whose current id already has saved data is refused (its new, empty id is simply dropped otherwise); forget removes every per-id file and
   nothing else.

## Status

- [x] Slice 1
- [x] Slice 2
- [ ] Slice 3
