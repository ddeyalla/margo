// One of several processes that change the same data files at once, for tests/file-lock.test.ts.
// Usage: node store-writer.mjs <data dir> <book id> <writer name> <count>
// Adds <count> threads to the book's state and adds 1 to a shared counter file <count> times, through the
// store the app uses. It starts once "go" arrives on stdin, so every writer runs at the same moment.
import path from "node:path";
import { createJiti } from "../../node_modules/jiti/lib/jiti.mjs";

const repo = path.resolve(import.meta.dirname, "../..");
const [dataDir, bookId, name, count] = process.argv.slice(2);
const jiti = createJiti(import.meta.url, { alias: { "@": repo } });
const { updateBookState, updateJson } = await jiti.import(path.join(repo, "lib/server/store.ts"));

process.stdout.write("ready\n");
await new Promise((resolve) => process.stdin.once("data", resolve));

const thread = (n) => ({ kind: "general", id: `${name}-${n}`, anchor: null, chapterTitle: null, provider: "claude", sessionId: null, createdAt: new Date(0).toISOString(), messages: [] });
const counter = path.join(dataDir, "counter.json");
await Promise.all(
  Array.from({ length: Number(count) }, (_, n) =>
    Promise.all([
      updateBookState(bookId, (state) => ({ ...state, threads: [...state.threads, thread(n)] }), dataDir),
      updateJson(counter, () => ({ n: 0 }), (current) => ({ n: current.n + 1 })),
    ]),
  ),
);
process.exit(0);
