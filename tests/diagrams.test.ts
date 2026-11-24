import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBookState, updateBookState } from "@/lib/server/store";
import { repairDiagram, repairedSource } from "@/lib/server/tutor/diagram";
import type { Provider, TutorEvent, TutorTurn } from "@/lib/server/tutor/types";
import { diagramFences, replaceDiagram } from "@/lib/shared/diagrams";
import type { BookId, Thread } from "@/lib/shared/types";

const bookId = "d".repeat(40) as BookId;

/* The tutor the route calls: replies with whatever the test sets, and records what it was sent. */
const tutor = vi.hoisted(() => ({ reply: "", sent: [] as string[] }));
vi.mock("@/lib/server/tutor/providers", async (original) => {
  const actual = await original<typeof import("@/lib/server/tutor/providers")>();
  const fake = {
    id: "claude",
    label: "Fake",
    probe: async () => ({ status: "ready", detail: null, version: null }),
    async *run(turn: TutorTurn) {
      tutor.sent.push(turn.messages[0].content);
      yield { type: "text", delta: tutor.reply } as TutorEvent;
    },
  };
  return { ...actual, PROVIDERS: { ...actual.PROVIDERS, claude: fake } };
});
vi.mock("@/lib/server/library", () => ({ findBook: async () => ({ book: { id: bookId } }) }));

const { POST } = await import("@/app/api/books/[bookId]/diagrams/route");

const fakeProvider = (events: TutorEvent[]): Provider => ({
  id: "claude",
  label: "Fake",
  probe: async () => ({ status: "ready", detail: null, version: null }),
  async *run() {
    yield* events;
  },
});

const BROKEN = "flowchart LR\n  A[f(x)] --> B";
const FIXED = 'flowchart LR\n  A["f(x)"] --> B';

describe("diagram fences", () => {
  it("finds closed mermaid fences and skips other code", () => {
    const text = ["Intro", "```mermaid", "graph TD", "  A-->B", "```", "", "```js", "```mermaid inside code", "```", "~~~Mermaid", "pie", "~~~"].join("\n");
    expect(diagramFences(text).map((fence) => fence.source)).toEqual(["graph TD\n  A-->B", "pie"]);
  });

  it("reads fences with CRLF line endings and inside list items", () => {
    expect(diagramFences("```mermaid\r\ngraph TD\r\n  A-->B\r\n```\r\n")[0]?.source).toBe("graph TD\n  A-->B");
    const listed = "- Step\n\n  ```mermaid\n  graph TD\n    A-->B\n  ```\n- Next";
    expect(diagramFences(listed)[0]?.source).toBe("graph TD\n  A-->B");
    expect(replaceDiagram(listed, 0, "graph TD\n  A-->C")).toBe("- Step\n\n  ```mermaid\n  graph TD\n    A-->C\n  ```\n- Next");
  });

  it("ignores a fence that never closes", () => {
    expect(diagramFences("```mermaid\ngraph TD\n  A-->")).toEqual([]);
  });

  it("swaps one diagram and leaves the text around it alone", () => {
    const text = `Before\n\n\`\`\`mermaid\n${BROKEN}\n\`\`\`\n\nAfter\n\n\`\`\`mermaid\npie\n\`\`\``;
    const swapped = replaceDiagram(text, 0, FIXED);
    expect(swapped).toBe(`Before\n\n\`\`\`mermaid\n${FIXED}\n\`\`\`\n\nAfter\n\n\`\`\`mermaid\npie\n\`\`\``);
    expect(replaceDiagram(text, 1, "pie\n  \"a\": 1")).toMatch(/```mermaid\npie\n {2}"a": 1\n```$/);
    expect(replaceDiagram(text, 2, FIXED)).toBe(text);
  });
});

describe("repairing a diagram", () => {
  it("reads the fixed diagram from a fenced or a bare reply", () => {
    expect(repairedSource(`Here:\n\n\`\`\`mermaid\n${FIXED}\n\`\`\`\n`)).toBe(FIXED);
    expect(repairedSource(`  ${FIXED}  `)).toBe(FIXED);
    expect(repairedSource("   ")).toBeNull();
    /* An unclosed fence would cut the rest of the answer apart once saved into it. */
    expect(repairedSource("```mermaid\ngraph TD")).toBeNull();
  });

  it("gives up when the tutor fails", async () => {
    const signal = new AbortController().signal;
    expect(await repairDiagram(fakeProvider([{ type: "error", message: "no" }]), BROKEN, "Parse error", null, signal)).toBeNull();
    expect(await repairDiagram(fakeProvider([{ type: "text", delta: FIXED }]), BROKEN, "Parse error", null, signal)).toBe(FIXED);
  });
});

describe("POST /api/books/[bookId]/diagrams", () => {
  const answerAt = "2026-11-24T10:00:01.000Z";
  const answer = (content: string): Thread => ({
    kind: "general",
    id: "t1",
    anchor: null,
    chapterTitle: null,
    provider: "claude",
    sessionId: null,
    createdAt: "2026-11-24T10:00:00.000Z",
    messages: [
      { role: "user", content: "Draw it", createdAt: "2026-11-24T10:00:00.000Z" },
      { role: "assistant", content, createdAt: answerAt },
    ],
  });
  const post = (body: unknown) =>
    POST(new Request("http://127.0.0.1/api", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ bookId }) });
  const stored = async () => (await readBookState(bookId)).threads[0].messages[1];

  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-diagrams-"));
    vi.stubEnv("DATA_DIR", path.join(dir, "data"));
    vi.stubEnv("BOOKS_DIR", dir);
    tutor.reply = `\`\`\`mermaid\n${FIXED}\n\`\`\``;
    tutor.sent = [];
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sends a broken diagram back with its error once and saves the fix", async () => {
    await updateBookState(bookId, (state) => ({ ...state, threads: [answer(`See:\n\n\`\`\`mermaid\n${BROKEN}\n\`\`\`\n\nDone.`)] }));
    const response = await post({ threadId: "t1", createdAt: answerAt, broken: [{ index: 0, error: "Parse error on line 2" }] });
    expect(response.status).toBe(200);
    const fixed = `See:\n\n\`\`\`mermaid\n${FIXED}\n\`\`\`\n\nDone.`;
    expect((await response.json()).content).toBe(fixed);
    expect(tutor.sent[0]).toContain(BROKEN);
    expect(tutor.sent[0]).toContain("Parse error on line 2");
    expect(await stored()).toMatchObject({ content: fixed, diagramsRepaired: true });

    /* Once only: a second request answers the saved text and doesn't call the tutor. */
    await post({ threadId: "t1", createdAt: answerAt, broken: [{ index: 0, error: "Still broken" }] });
    expect(tutor.sent).toHaveLength(1);
  });

  it("keeps the answer and its one chance when the tutor sends no fix back", async () => {
    tutor.reply = "";
    const content = `\`\`\`mermaid\n${BROKEN}\n\`\`\``;
    await updateBookState(bookId, (state) => ({ ...state, threads: [answer(content)] }));
    const response = await post({ threadId: "t1", createdAt: answerAt, broken: [{ index: 0, error: "Parse error" }] });
    expect((await response.json()).content).toBe(content);
    expect((await stored()).diagramsRepaired).toBeUndefined();
  });

  it("refuses a request that names no broken diagram or an answer that isn't there", async () => {
    await updateBookState(bookId, (state) => ({ ...state, threads: [answer("No diagram.")] }));
    expect((await post({ threadId: "t1", createdAt: answerAt, broken: [] })).status).toBe(400);
    expect((await post({ threadId: "t1", createdAt: "nope", broken: [{ index: 0, error: "x" }] })).status).toBe(404);
  });
});
