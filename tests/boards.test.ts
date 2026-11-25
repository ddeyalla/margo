import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  boardRecall,
  compactScene,
  isBoardFile,
  parseCheckReply,
  parseCompactScene,
  parseEditReply,
  parseReviewReply,
  validateOps,
  type BoardElement,
  type CompactScene,
} from "@/lib/shared/boards";
import { courseMastery, type BookEvidence } from "@/lib/shared/mastery";
import type { Course } from "@/lib/shared/courses";
import type { Provider, TutorEvent, TutorTurn } from "@/lib/server/tutor/types";
import type { BookId } from "@/lib/shared/types";

vi.mock("@/lib/server/search/index", () => ({
  bookText: async () => ({
    blocks: [
      { chapter: "Habits", text: "A cue triggers a craving, which motivates a response, which delivers a reward.", anchor: null },
      { chapter: "Elsewhere", text: "Not this chapter.", anchor: null },
    ],
  }),
}));

const { askAboutBoard, boardPath, openBoard, recordAttempt, saveBoard } = await import("@/lib/server/boards");
const { readBookState } = await import("@/lib/server/store");

const box = (id: string, x: number, y: number, extra: Partial<BoardElement> = {}): BoardElement => ({ id, type: "rectangle", x, y, width: 100, height: 40, ...extra });
const label = (id: string, containerId: string, text: string): BoardElement => ({ id, type: "text", x: 0, y: 0, width: 10, height: 10, text, originalText: text, containerId });
const arrow = (id: string, from: string | null, to: string | null): BoardElement => ({
  id,
  type: "arrow",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  startBinding: from ? { elementId: from } : null,
  endBinding: to ? { elementId: to } : null,
});

/* Cue → Craving → Response, drawn out of order, with a label on one arrow, a stray arrow, a sketch and a suggestion. */
const drawing: BoardElement[] = [
  box("craving", 300, 100),
  label("t-craving", "craving", "Craving"),
  box("cue", 100, 104),
  label("t-cue", "cue", "Cue"),
  { id: "response", type: "text", x: 100, y: 300, width: 80, height: 20, text: "Response\n(habit)", originalText: "Response\n(habit)", containerId: null },
  arrow("a1", "cue", "craving"),
  label("t-a1", "a1", "triggers"),
  arrow("a2", "craving", "response"),
  arrow("stray", "cue", null),
  { id: "doodle", type: "freedraw", x: 0, y: 0, width: 5, height: 5 },
  box("gone", 0, 0, { isDeleted: true }),
  box("hint", 500, 500, { customData: { suggestion: "s1" } }),
];

describe("the compact scene the tutor reads", () => {
  const { scene, ids } = compactScene(drawing);

  it("lists ideas in reading order with their words, and links by short id", () => {
    expect(scene.nodes).toEqual([
      { id: "n1", text: "Cue", x: 100, y: 104 },
      { id: "n2", text: "Craving", x: 300, y: 100 },
      { id: "n3", text: "Response (habit)", x: 100, y: 300 },
    ]);
    expect(scene.links).toEqual([
      { id: "l1", from: "n1", to: "n2", label: "triggers" },
      { id: "l2", from: "n2", to: "n3" },
    ]);
    expect(ids).toMatchObject({ n1: "cue", n2: "craving", n3: "response", l1: "a1", l2: "a2" });
  });

  it("counts loose arrows and sketches, and leaves out deleted elements and the tutor's suggestions", () => {
    expect(scene.loose).toBe(1);
    expect(scene.sketches).toBe(1);
    expect(Object.values(ids)).not.toContain("gone");
    expect(Object.values(ids)).not.toContain("hint");
  });

  it("round-trips through the server's check, and refuses links to nodes it doesn't have", () => {
    expect(parseCompactScene(JSON.parse(JSON.stringify(scene)))).toEqual(scene);
    expect(parseCompactScene({ ...scene, links: [{ id: "l1", from: "n1", to: "n9" }] })).toBeNull();
    expect(parseCompactScene({ ...scene, nodes: [{ id: "x1", text: "", x: 0, y: 0 }] })).toBeNull();
    expect(parseCompactScene({ ...scene, nodes: [{ id: "n1", text: "a", x: Infinity, y: 0 }] })).toBeNull();
  });
});

const scene: CompactScene = compactScene(drawing).scene;

describe("the tutor's ops", () => {
  it("takes adds, links to new nodes, updates and deletes that name what is on the board", () => {
    const ops = validateOps(
      [
        { op: "add_node", id: "reward", text: "  Reward ", x: 500.4, y: 300 },
        { op: "add_link", from: "n3", to: "reward", label: "delivers" },
        { op: "update", id: "l1", text: "triggers a" },
        { op: "delete", id: "l2" },
      ],
      scene,
    );
    expect(ops).toEqual([
      { op: "add_node", id: "reward", text: "Reward", x: 500, y: 300 },
      { op: "add_link", from: "n3", to: "reward", label: "delivers" },
      { op: "update", id: "l1", text: "triggers a" },
      { op: "delete", id: "l2" },
    ]);
  });

  it("says what is wrong, for the tutor to fix", () => {
    expect(validateOps({}, scene)).toBe('"ops" must be a list.');
    expect(validateOps([{ op: "add_node", id: "n1", text: "x" }], scene)).toMatch(/already taken/);
    expect(validateOps([{ op: "add_node", id: "Reward!", text: "x" }], scene)).toMatch(/short lowercase name/);
    expect(validateOps([{ op: "add_link", from: "n1", to: "n7" }], scene)).toMatch(/"n7" is not a node/);
    expect(validateOps([{ op: "add_link", from: "n1", to: "l1" }], scene)).toMatch(/"l1" is not a node/);
    expect(validateOps([{ op: "add_link", from: "n1", to: "n1" }], scene)).toMatch(/two different nodes/);
    expect(validateOps([{ op: "update", id: "n9", text: "x" }], scene)).toMatch(/not on the board/);
    expect(validateOps([{ op: "update", id: "n1", text: "x" }, { op: "delete", id: "n1" }], scene)).toMatch(/one change per/);
    expect(validateOps([{ op: "add_link", from: "n1", to: "n2" }, { op: "delete", id: "n2" }], scene)).toMatch(/being removed/);
    expect(validateOps([{ op: "add_node", id: "far", text: "x", x: 1e9 }], scene)).toMatch(/within/);
    expect(validateOps([{ op: "paint" }], scene)).toMatch(/"op" must be/);
    expect(validateOps(Array.from({ length: 31 }, (_, i) => ({ op: "add_node", id: `x${i}`, text: "x" })), scene)).toMatch(/at most 30/);
  });

  it("reads an edit reply from around prose and fences, and wants at least one op", () => {
    expect(parseEditReply('Here:\n```json\n{"ops": [{"op": "delete", "id": "n1"}]}\n```', scene)).toEqual([{ op: "delete", id: "n1" }]);
    expect(parseEditReply('{"ops": []}', scene)).toBe("Send at least one op.");
    expect(parseEditReply("no json", scene)).toBe("The reply had no JSON object.");
  });
});

describe("the tutor's review and draw-it-back check", () => {
  it("reads a review: missing ideas, wrong links by id, one question, and ops", () => {
    const review = parseReviewReply(
      JSON.stringify({ missing: ["Reward"], wrong_links: [{ link: "l2", why: "The craving motivates the response." }], question: "Why does a cue lead to a craving?", ops: [{ op: "add_node", id: "reward", text: "Reward" }] }),
      scene,
    );
    expect(review).toEqual({
      missing: ["Reward"],
      wrongLinks: [{ link: "l2", why: "The craving motivates the response." }],
      question: "Why does a cue lead to a craving?",
      ops: [{ op: "add_node", id: "reward", text: "Reward" }],
    });
    expect(parseReviewReply(JSON.stringify({ missing: [], wrong_links: [{ link: "l9", why: "x" }], question: "q" }), scene)).toMatch(/not a link on the board/);
    expect(parseReviewReply(JSON.stringify({ missing: [], wrong_links: [] }), scene)).toMatch(/question/);
  });

  it("reads a check as the first wrong link or none, never a score", () => {
    expect(parseCheckReply('{"wrong": null, "note": "Every link holds."}', scene)).toEqual({ wrong: null, note: "Every link holds." });
    expect(parseCheckReply('{"wrong": {"link": "l2", "hint": "Reread what the craving does."}, "note": "Close."}', scene)).toEqual({
      wrong: { link: "l2", hint: "Reread what the craving does." },
      note: "Close.",
    });
    expect(parseCheckReply('{"wrong": {"link": "n1", "hint": "x"}, "note": "x"}', scene)).toMatch(/name a link/);
  });
});

describe("a board in a Course's retention", () => {
  const a = "a".repeat(40) as BookId;
  const course = {
    books: [{ key: "A", title: "A", author: null, edition: null, bookId: a }],
    units: [{ title: "U", weeks: null, concepts: [], readings: [{ book: "A", chapters: [{ title: "Habits", inBook: true }] }] }],
  } as unknown as Pick<Course, "books" | "units">;
  const day = (n: number) => new Date(Date.UTC(2026, 2, 10 + n, 9)).toISOString();

  it("has nothing to retain before a draw-it-back", () => {
    expect(boardRecall({ attempts: [] }, new Date())).toBeNull();
  });

  it("counts a chapter's draw-it-backs once, by the chapter or one of its sections, and fades with time", () => {
    const board = { chapter: "Habits, part 2", labels: ["Habits, part 2"], path: null, attempts: [{ at: day(0), correct: true }, { at: day(2), correct: true }] };
    const elsewhere = { ...board, chapter: "Elsewhere", labels: ["Elsewhere"] };
    const evidence = (boards: BookEvidence["boards"]) => new Map<BookId, BookEvidence>([[a, { cardSets: [], quizzes: [], boards }]]);
    expect(courseMastery(course, evidence([elsewhere]), new Date(day(3))).items).toBe(0);
    const inCourse = { ...board, chapter: "Habits", labels: ["Habits", "Habits, part 2"] };
    const soon = courseMastery(course, evidence([inCourse]), new Date(day(3)));
    const late = courseMastery(course, evidence([inCourse]), new Date(day(90)));
    expect(soon.items).toBe(1);
    expect(soon.retained!).toBeGreaterThan(late.retained!);
  });

  it("holds a board with a wrong link below one redrawn right", () => {
    const right = boardRecall({ attempts: [{ at: day(0), correct: true }, { at: day(2), correct: true }] }, new Date(day(4)))!;
    const wrong = boardRecall({ attempts: [{ at: day(0), correct: true }, { at: day(2), correct: false }] }, new Date(day(4)))!;
    expect(wrong.recall).toBeLessThan(right.recall);
  });
});

/* Storage: a temporary notes folder and data folder. */

const bookId = "b".repeat(40) as BookId;
let notes: string;
const EMPTY = JSON.stringify({ type: "excalidraw", version: 2, source: "rigg-learn", elements: [], appState: {}, files: {} });
const WITH = (text: string) => JSON.stringify({ type: "excalidraw", version: 2, elements: [{ id: "x", type: "text", text }], appState: {}, files: {} });

beforeEach(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rigg-boards-"));
  notes = path.join(dir, "notes");
  await mkdir(notes);
  vi.stubEnv("DATA_DIR", path.join(dir, "data"));
  vi.stubEnv("BOOKS_DIR", dir);
});
afterEach(() => vi.unstubAllEnvs());

const save = (chapter: string, text: string, baseHash: string | null, bookTitle = "Atomic Habits") =>
  saveBoard(notes, { bookId, bookTitle }, { chapter, labels: [chapter], text, baseHash });

describe("board files in the notes folder", () => {
  it("names the file after the book and chapter, without characters a file system or Obsidian rejects", () => {
    expect(boardPath("Atomic Habits: Tiny Changes", "1. The Fundamentals / Why")).toBe("Whiteboards/Atomic Habits - Tiny Changes/1. The Fundamentals Why.excalidraw");
    expect(boardPath("../../etc", "..")).toBe("Whiteboards/etc/Untitled section.excalidraw");
    expect(boardPath("", "#^[]")).toBe("Whiteboards/Untitled book/Untitled section.excalidraw");
  });

  it("creates the board, remembers its file, and saves over it while nothing else changed it", async () => {
    const first = await save("Habits", EMPTY, null);
    expect(first).toMatchObject({ state: "saved", path: "Whiteboards/Atomic Habits/Habits.excalidraw" });
    const opened = await openBoard(notes, bookId, "Habits");
    expect(opened.file?.text).toBe(EMPTY);
    const second = await save("Habits", WITH("cue"), opened.file!.hash);
    expect(second.state).toBe("saved");
    expect(await readFile(path.join(notes, "Whiteboards/Atomic Habits/Habits.excalidraw"), "utf8")).toBe(WITH("cue"));
    /* The book's title changing later doesn't lose the file. */
    expect((await saveBoard(notes, { bookId, bookTitle: "Renamed" }, { chapter: "Habits", labels: ["Habits"], text: WITH("craving"), baseHash: (second as { hash: string }).hash })).state).toBe("saved");
  });

  it("never replaces a file it didn't write: a second chapter with the same name gets its own", async () => {
    await mkdir(path.join(notes, "Whiteboards/Atomic Habits"), { recursive: true });
    await writeFile(path.join(notes, "Whiteboards/Atomic Habits/Habits.excalidraw"), "the reader's own");
    const saved = await save("Habits", EMPTY, null);
    expect(saved).toMatchObject({ state: "saved", path: "Whiteboards/Atomic Habits/Habits 1.excalidraw" });
    expect(await readFile(path.join(notes, "Whiteboards/Atomic Habits/Habits.excalidraw"), "utf8")).toBe("the reader's own");
  });

  it("keeps both when Obsidian changed the board since it was opened", async () => {
    await save("Habits", EMPTY, null);
    const opened = await openBoard(notes, bookId, "Habits");
    await writeFile(path.join(notes, opened.path!), WITH("from Obsidian"));
    const saved = await save("Habits", WITH("from the app"), opened.file!.hash);
    expect(saved.state).toBe("conflict");
    if (saved.state !== "conflict") return;
    expect(saved.current?.text).toBe(WITH("from Obsidian"));
    expect(saved.copy).toMatch(/^Whiteboards\/Atomic Habits\/Habits \(conflict .+\)\.excalidraw$/);
    expect(await readFile(path.join(notes, saved.copy), "utf8")).toBe(WITH("from the app"));
    expect(await readFile(path.join(notes, opened.path!), "utf8")).toBe(WITH("from Obsidian"));
  });

  it("refuses text that isn't a board, and a board folder that leaves the notes folder through a link", async () => {
    await expect(save("Habits", "{}", null)).rejects.toThrow(/isn't an Excalidraw board/);
    const outside = await mkdtemp(path.join(tmpdir(), "rigg-outside-"));
    await symlink(outside, path.join(notes, "Whiteboards"));
    await expect(save("Habits", EMPTY, null)).rejects.toThrow(/link the app does not follow/);
    expect(await readdir(outside)).toEqual([]);
  });

  it("checks a saved board looks like Excalidraw's file", () => {
    expect(isBoardFile(EMPTY)).toBe(true);
    expect(isBoardFile('{"type":"excalidraw"}')).toBe(false);
    expect(isBoardFile("not json")).toBe(false);
  });

  it("records draw-it-back attempts in the book's state", async () => {
    await recordAttempt(bookId, "Habits", ["Habits"], { at: "2026-03-10T09:00:00.000Z", correct: false });
    expect((await readBookState(bookId)).boards).toEqual([{ chapter: "Habits", labels: ["Habits"], path: null, attempts: [{ at: "2026-03-10T09:00:00.000Z", correct: false }] }]);
  });
});

describe("asking the tutor about a board", () => {
  const tutor = (replies: string[]) => {
    const turns: TutorTurn[] = [];
    const provider: Provider = {
      id: "claude",
      label: "Fake",
      probe: async () => ({ status: "ready", detail: null, version: null }),
      async *run(turn) {
        turns.push(turn);
        yield { type: "text", delta: replies[turns.length - 1] ?? "" } as TutorEvent;
      },
    };
    return { provider, turns };
  };
  const ask = (provider: Provider, kind: "review" | "check" | "edit" = "edit") =>
    askAboutBoard(
      provider,
      {
        bookId,
        book: { title: "Atomic Habits", author: null },
        chapter: "Habits",
        labels: ["Habits"],
        scene,
        image: { mediaType: "image/png", data: "AAAA" },
        ask: kind === "edit" ? { kind, instruction: "Add the reward." } : { kind },
      },
      null,
      new AbortController().signal,
    );

  it("sends the chapter's own text, the board and its picture", async () => {
    const { provider, turns } = tutor(['{"ops": [{"op": "add_node", "id": "reward", "text": "Reward"}]}']);
    expect(await ask(provider)).toEqual({ kind: "edit", ops: [{ op: "add_node", id: "reward", text: "Reward" }] });
    const message = turns[0].messages[0];
    expect(message.content).toContain("A cue triggers a craving");
    expect(message.content).not.toContain("Not this chapter.");
    expect(message.content).toContain('"id":"l1"');
    expect(message.content).toContain("The reader asks: Add the reward.");
    expect(message.images).toEqual([{ mediaType: "image/png", data: "AAAA" }]);
  });

  it("sends a reply that can't be used back once with the reason, then gives up", async () => {
    const repaired = tutor(['{"ops": [{"op": "delete", "id": "n9"}]}', '{"ops": [{"op": "delete", "id": "n3"}]}']);
    expect(await ask(repaired.provider)).toEqual({ kind: "edit", ops: [{ op: "delete", id: "n3" }] });
    expect(repaired.turns[1].messages.at(-1)!.content).toContain('"n9" is not on the board.');
    const hopeless = tutor(["nope", "still nope"]);
    await expect(ask(hopeless.provider, "check")).rejects.toThrow(/couldn't be read/);
    expect(hopeless.turns).toHaveLength(2);
  });
});
