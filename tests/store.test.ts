import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readBookState, updateBookState } from "@/lib/server/store";
import type { BookId, Thread } from "@/lib/shared/types";

const id = "a".repeat(40) as BookId;

const thread = (n: number): Thread => ({
  id: `t${n}`,
  anchor: { kind: "epub", cfi: `epubcfi(/6/${n})` },
  quote: `quote ${n}`,
  before: "",
  after: "",
  chapterTitle: null,
  action: "explain",
  provider: "claude",
  sessionId: null,
  createdAt: new Date(0).toISOString(),
  messages: [],
});

describe("book state store", () => {
  it("starts empty for a book that was never opened", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-store-"));
    expect(await readBookState(id, dir)).toMatchObject({ meta: null, position: null, threads: [] });
  });

  it("keeps every concurrent update and leaves valid JSON", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-store-"));
    await Promise.all([
      ...Array.from({ length: 20 }, (_, n) =>
        updateBookState(id, (state) => ({ ...state, threads: [...state.threads, thread(n)] }), dir),
      ),
      updateBookState(id, (state) => ({ ...state, position: { kind: "epub", cfi: "epubcfi(/6/2)", fraction: 0.5 } }), dir),
    ]);

    const raw = JSON.parse(await readFile(path.join(dir, `${id}.json`), "utf8"));
    expect(raw.threads).toHaveLength(20);
    expect(raw.position).toEqual({ kind: "epub", cfi: "epubcfi(/6/2)", fraction: 0.5 });
    expect(await readdir(dir)).toEqual([`${id}.json`]);
  });
});
