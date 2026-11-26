import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  boardChapter,
  boardRecall,
  chapterBoardId,
  compactScene,
  diagramOps,
  diagramTitle,
  relatedBoard,
  normalizeBoard,
  isBoardFile,
  MAX_BOARD_BYTES,
  parseCheckReply,
  parseCompactScene,
  boardOpsIn,
  parseBoardMention,
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

const { askAboutBoard, boardPath, chapterBoard, createBoard, listBoards, openBoard, recordAttempt, removeBoard, renameBoard, replaceIfUnchanged, saveBoard } = await import("@/lib/server/boards");
const { readBookState } = await import("@/lib/server/store");
const { answerChanges } = await import("@/components/board/link");

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
    expect(validateOps(Array.from({ length: 61 }, (_, i) => ({ op: "add_node", id: `x${i}`, text: "x" })), scene)).toMatch(/at most 60/);
  });

});

describe("the board in the chat", () => {
  const { ids } = compactScene(drawing);
  const mention = { id: "board-0001", title: "Habits", scene, ids };

  it("takes a board mention whose ids are exactly the scene's, each an element id", () => {
    expect(parseBoardMention(mention)).toEqual(mention);
    expect(parseBoardMention({ ...mention, id: "x" })).toBeNull();
    expect(parseBoardMention({ ...mention, title: " " })).toBeNull();
    expect(parseBoardMention({ ...mention, scene: { nodes: [{ id: "bad" }], links: [] } })).toBeNull();
    const { n1: _dropped, ...missing } = ids;
    void _dropped;
    expect(parseBoardMention({ ...mention, ids: missing })).toBeNull();
    expect(parseBoardMention({ ...mention, ids: { ...ids, n1: "has space" } })).toBeNull();
    expect(parseBoardMention({ ...mention, ids: { ...ids, n99: "extra" } })).toBeNull();
  });

  it("reads an answer's last board fence, a list of ops or an object holding one, against the scene that was sent", () => {
    const ops = '[{"op": "add_node", "id": "reward", "text": "Reward"}, {"op": "add_link", "from": "n3", "to": "reward"}]';
    expect(boardOpsIn(`Added the reward.\n\n\`\`\`board\n${ops}\n\`\`\``, scene)).toEqual([
      { op: "add_node", id: "reward", text: "Reward" },
      { op: "add_link", from: "n3", to: "reward" },
    ]);
    expect(boardOpsIn('```board\n{"ops": [{"op": "delete", "id": "l1"}]}\n```', scene)).toEqual([{ op: "delete", id: "l1" }]);
    expect(boardOpsIn('```board\n[{"op": "delete", "id": "l1"}]\n```\nThen:\n```board\n[{"op": "delete", "id": "l2"}]\n```', scene)).toEqual([{ op: "delete", id: "l2" }]);
  });

  it("reads an answer's changes against the board its question carried, never one stopped early", () => {
    const fence = '```board\n[{"op": "delete", "id": "l1"}]\n```';
    const messages = [
      { role: "user" as const, content: "Fix the first link", createdAt: "", board: mention },
      { role: "assistant" as const, content: `Fixed.\n\n${fence}`, createdAt: "" },
      { role: "user" as const, content: "And now?", createdAt: "" },
      { role: "assistant" as const, content: fence, createdAt: "" },
    ];
    expect(answerChanges("t1", messages, 1)).toEqual({ key: "t1:1", board: mention, ops: [{ op: "delete", id: "l1" }], fenceAt: "Fixed.\n\n".length });
    /* A longer fence is found at its own start, where the Markdown block begins. */
    const long = [messages[0], { ...messages[1], content: 'Fixed.\n\n````board\n[{"op": "delete", "id": "l1"}]\n````' }];
    expect(answerChanges("t1", long, 1)?.fenceAt).toBe("Fixed.\n\n".length);
    expect(answerChanges("t1", messages, 3)).toBeNull();
    expect(answerChanges("t1", [messages[0], { ...messages[1], partial: true }], 1)).toBeNull();
  });

  it("finds nothing in an answer with no board fence, and says why a fence can't be used", () => {
    expect(boardOpsIn("A cue comes first.\n```json\n[]\n```", scene)).toBeNull();
    expect(boardOpsIn("```board\n[]\n```", scene)).toBeNull();
    expect(boardOpsIn("```board\n[{\n```", scene)).toMatch(/valid JSON/);
    expect(boardOpsIn('```board\n[{"op": "delete", "id": "n9"}]\n```', scene)).toMatch(/not on the board/);
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
    const board = {
      id: "chapter-1",
      title: "Habits, part 2",
      kind: "chapter" as const,
      chapter: "Habits, part 2",
      labels: ["Habits, part 2"],
      path: null,
      attempts: [{ at: day(0), correct: true }, { at: day(2), correct: true }],
    };
    const elsewhere = { ...board, chapter: "Elsewhere", labels: ["Elsewhere"] };
    const evidence = (boards: BookEvidence["boards"]) => new Map<BookId, BookEvidence>([[a, { cardSets: [], quizzes: [], boards }]]);
    expect(courseMastery(course, evidence([elsewhere]), new Date(day(3))).items).toBe(0);
    const inCourse = { ...board, chapter: "Habits", labels: ["Habits", "Habits, part 2"] };
    const soon = courseMastery(course, evidence([inCourse]), new Date(day(3)));
    const late = courseMastery(course, evidence([inCourse]), new Date(day(90)));
    expect(soon.items).toBe(1);
    expect(soon.retained!).toBeGreaterThan(late.retained!);
    /* A board of the reader's own about the same chapter is not a draw-it-back. */
    expect(courseMastery(course, evidence([{ ...inCourse, id: "free-board", kind: "free" }]), new Date(day(3))).items).toBe(0);
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

const save = async (chapter: string, text: string, baseHash: string | null, bookTitle = "Atomic Habits") => {
  const { id } = await chapterBoard(bookId, chapter, [chapter]);
  return saveBoard(notes, { bookId, bookTitle }, { id, text, baseHash });
};
const openChapter = (chapter: string) => openBoard(notes, bookId, chapterBoardId(chapter));

describe("board files in the notes folder", () => {
  it("names the file after the book and board, without characters a file system or Obsidian rejects", () => {
    expect(boardPath("Atomic Habits: Tiny Changes", "1. The Fundamentals / Why")).toBe("Whiteboards/Atomic Habits - Tiny Changes/1. The Fundamentals Why.excalidraw");
    expect(boardPath("../../etc", "..")).toBe("Whiteboards/etc/Untitled board.excalidraw");
    expect(boardPath("", "#^[]")).toBe("Whiteboards/Untitled book/Untitled board.excalidraw");
  });

  it("creates the board, remembers its file, and saves over it while nothing else changed it", async () => {
    const first = await save("Habits", EMPTY, null);
    expect(first).toMatchObject({ state: "saved", path: "Whiteboards/Atomic Habits/Habits.excalidraw" });
    const opened = await openChapter("Habits");
    expect(opened.file?.text).toBe(EMPTY);
    const second = await save("Habits", WITH("cue"), opened.file!.hash);
    expect(second.state).toBe("saved");
    expect(await readFile(path.join(notes, "Whiteboards/Atomic Habits/Habits.excalidraw"), "utf8")).toBe(WITH("cue"));
    /* The book's title changing later doesn't lose the file. */
    expect((await saveBoard(notes, { bookId, bookTitle: "Renamed" }, { id: chapterBoardId("Habits"), text: WITH("craving"), baseHash: (second as { hash: string }).hash })).state).toBe("saved");
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
    const opened = await openChapter("Habits");
    await writeFile(path.join(notes, opened.board.path!), WITH("from Obsidian"));
    const saved = await save("Habits", WITH("from the app"), opened.file!.hash);
    expect(saved.state).toBe("conflict");
    if (saved.state !== "conflict") return;
    expect(saved.current?.text).toBe(WITH("from Obsidian"));
    expect(saved.copy).toMatch(/^Whiteboards\/Atomic Habits\/Habits \(conflict .+\)\.excalidraw$/);
    expect(await readFile(path.join(notes, saved.copy), "utf8")).toBe(WITH("from the app"));
    expect(await readFile(path.join(notes, opened.board.path!), "utf8")).toBe(WITH("from Obsidian"));
  });

  it("keeps both when Obsidian saves the board between the app's check and its write", async () => {
    await save("Habits", EMPTY, null);
    const opened = await openChapter("Habits");
    const file = path.join(notes, opened.board.path!);
    const saved = await replaceIfUnchanged(file, WITH("from the app"), opened.file!.hash, { beforeReplace: () => writeFile(file, WITH("from Obsidian")) });
    expect(saved.state).toBe("conflict");
    if (saved.state !== "conflict") return;
    expect(saved.current?.text).toBe(WITH("from Obsidian"));
    expect(await readFile(file, "utf8")).toBe(WITH("from Obsidian"));
    expect(await readFile(saved.copy, "utf8")).toBe(WITH("from the app"));
    /* No temporary file is left behind either way. */
    expect((await readdir(path.dirname(file))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    /* Obsidian writing the very same text meanwhile is no conflict. */
    const same = await replaceIfUnchanged(file, WITH("twins"), saved.current!.hash, { beforeReplace: () => writeFile(file, WITH("twins")) });
    expect(same.state).toBe("saved");
    const clean = await replaceIfUnchanged(file, WITH("again"), same.state === "saved" ? same.hash : "");
    expect(clean.state).toBe("saved");
    expect((await readdir(path.dirname(file))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("keeps the first file when two first saves of a chapter's board race, and still makes one when the file was removed", async () => {
    const [first, second] = await Promise.all([save("Habits", WITH("first reader"), null), save("Habits", WITH("second reader"), null)]);
    expect(first).toMatchObject({ state: "saved", path: "Whiteboards/Atomic Habits/Habits.excalidraw" });
    expect(second.state).toBe("conflict");
    if (second.state !== "conflict") return;
    expect(second.path).toBe("Whiteboards/Atomic Habits/Habits.excalidraw");
    expect(second.current?.text).toBe(WITH("first reader"));
    expect(await readFile(path.join(notes, second.copy), "utf8")).toBe(WITH("second reader"));
    expect((await openChapter("Habits")).file?.text).toBe(WITH("first reader"));
    /* The same text again, such as one more save as the page closes, is no conflict. */
    expect((await save("Habits", WITH("first reader"), null)).state).toBe("saved");
    /* The reader deleted the file in Obsidian: a save from nothing makes it again, under its name. */
    await rm(path.join(notes, "Whiteboards/Atomic Habits/Habits.excalidraw"));
    expect(await save("Habits", WITH("redrawn"), null)).toMatchObject({ state: "saved", path: "Whiteboards/Atomic Habits/Habits.excalidraw" });
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
    /* The limit is in bytes: text under it in characters but over it in UTF-8 is refused. */
    const wide = JSON.stringify({ type: "excalidraw", elements: [{ id: "x", type: "text", text: "é".repeat(MAX_BOARD_BYTES / 2 + 10) }] });
    expect(wide.length).toBeLessThan(MAX_BOARD_BYTES);
    expect(isBoardFile(wide)).toBe(false);
    expect(isBoardFile(JSON.stringify({ type: "excalidraw", elements: [{ id: "x", type: "text", text: "é".repeat(MAX_BOARD_BYTES / 4) }] }))).toBe(true);
  });

  it("records draw-it-back attempts on the chapter's board in the book's state", async () => {
    const { id } = await chapterBoard(bookId, "Habits", ["Habits", "Cues"]);
    await recordAttempt(bookId, id, { at: "2026-03-10T09:00:00.000Z", correct: false });
    expect((await readBookState(bookId)).boards).toEqual([
      { id, title: "Habits", kind: "chapter", chapter: "Habits", labels: ["Habits", "Cues"], path: null, attempts: [{ at: "2026-03-10T09:00:00.000Z", correct: false }] },
    ]);
  });
});

describe("many boards in a book", () => {
  const book = () => ({ bookId, bookTitle: "Atomic Habits" });

  it("reads a board saved before books had many as that chapter's board, the same each time", () => {
    const legacy = { chapter: "Habits", labels: ["Habits"], path: "Whiteboards/Atomic Habits/Habits.excalidraw", attempts: [] };
    const once = normalizeBoard(legacy);
    expect(once).toEqual({ ...legacy, id: chapterBoardId("Habits"), title: "Habits", kind: "chapter" });
    expect(normalizeBoard(legacy)).toEqual(once);
    expect(normalizeBoard(once)).toEqual(once);
    expect(chapterBoardId("Habits")).not.toBe(chapterBoardId("Cues"));
  });

  it("asks for a chapter's board twice and gets one board", async () => {
    const [a, b] = await Promise.all([chapterBoard(bookId, "Habits", ["Habits"]), chapterBoard(bookId, "Habits", ["Habits"])]);
    expect(a.id).toBe(b.id);
    expect((await readBookState(bookId)).boards).toHaveLength(1);
  });

  it("makes a board of the reader's own with its file, named after its title, about the chapter being read", async () => {
    const board = await createBoard(notes, book(), { title: "Attention flow", chapter: "Habits", labels: ["Habits"], text: WITH("query"), from: null });
    expect(board).toMatchObject({ title: "Attention flow", kind: "free", chapter: "Habits", path: "Whiteboards/Atomic Habits/Attention flow.excalidraw" });
    expect(await readFile(path.join(notes, board.path!), "utf8")).toBe(WITH("query"));
    const again = await createBoard(notes, book(), { title: "Attention flow", chapter: null, labels: [], text: EMPTY, from: null });
    expect(again.id).not.toBe(board.id);
    expect(again.path).toBe("Whiteboards/Atomic Habits/Attention flow 1.excalidraw");
    expect((await openBoard(notes, bookId, board.id)).file?.text).toBe(WITH("query"));
  });

  it("opens the same board for the same chat diagram, however quickly it's asked twice", async () => {
    const input = { title: "Loop", chapter: null, labels: [], text: WITH("loop"), from: "hash-of-the-diagram" };
    const [a, b] = await Promise.all([createBoard(notes, book(), input), createBoard(notes, book(), input)]);
    expect(a.id).toBe(b.id);
    expect((await readBookState(bookId)).boards).toHaveLength(1);
    expect(await readdir(path.join(notes, "Whiteboards/Atomic Habits"))).toEqual(["Loop.excalidraw"]);
  });

  it("saves a board by its id, and keeps both when another app changed it", async () => {
    const board = await createBoard(notes, book(), { title: "Map", chapter: null, labels: [], text: EMPTY, from: null });
    const opened = await openBoard(notes, bookId, board.id);
    const saved = await saveBoard(notes, book(), { id: board.id, text: WITH("one"), baseHash: opened.file!.hash });
    expect(saved.state).toBe("saved");
    const stale = await saveBoard(notes, book(), { id: board.id, text: WITH("two"), baseHash: opened.file!.hash });
    expect(stale.state).toBe("conflict");
    await expect(saveBoard(notes, book(), { id: "no-such-board", text: EMPTY, baseHash: null })).rejects.toThrow(/isn't in this book/);
  });

  it("renames a board without moving its file, and removes it from the book leaving the file", async () => {
    const board = await createBoard(notes, book(), { title: "Draft", chapter: null, labels: [], text: EMPTY, from: null });
    const renamed = await renameBoard(bookId, board.id, "Habit loop");
    expect(renamed).toMatchObject({ title: "Habit loop", path: board.path });
    expect((await listBoards(notes, bookId)).map((b) => b.title)).toEqual(["Habit loop"]);
    await removeBoard(bookId, board.id);
    expect(await listBoards(notes, bookId)).toEqual([]);
    expect(await readFile(path.join(notes, board.path!), "utf8")).toBe(EMPTY);
  });

  it("updates a chapter board's sections when they change, even in a way joining them with newlines would hide", async () => {
    await chapterBoard(bookId, "Habits", ["Habits", "Cues\nand cravings"]);
    const board = await chapterBoard(bookId, "Habits", ["Habits", "Cues", "and cravings"]);
    expect(board.labels).toEqual(["Habits", "Cues", "and cravings"]);
  });

  it("says a board removed meanwhile is gone, rather than renaming or recording nothing", async () => {
    const board = await createBoard(notes, book(), { title: "Draft", chapter: null, labels: [], text: EMPTY, from: null });
    await removeBoard(bookId, board.id);
    await expect(renameBoard(bookId, board.id, "New")).rejects.toThrow(/isn't in this book/);
    await expect(recordAttempt(bookId, board.id, { at: "2026-03-10T09:00:00.000Z", correct: true })).rejects.toThrow(/isn't in this book/);
  });

  it("keeps a chapter's own board, whose draw-it-backs count toward retention", async () => {
    const { id } = await chapterBoard(bookId, "Habits", ["Habits"]);
    await expect(removeBoard(bookId, id)).rejects.toThrow(/stays/);
    expect((await readBookState(bookId)).boards).toHaveLength(1);
  });
});

describe("diagrams drawn for a board", () => {
  it("names the board from the diagram's first comment, or else its first label", () => {
    const named = "%% How attention works\nflowchart TD\n  Q[Query] --> S[Scores]";
    expect(diagramTitle(named)).toBe("How attention works");
    expect(diagramTitle("%%{init: {}}%%\nflowchart TD\n  A[Cue] --> B")).toBe("Cue");
    expect(diagramTitle("flowchart TD\n  A[Cue] --> B[Craving]")).toBe("Cue");
    /* An empty frontmatter title, quoted or bare, falls back to the first label. */
    expect(diagramTitle('---\ntitle: ""\n---\nflowchart TD\n  A[Cue] --> B')).toBe("Cue");
    expect(diagramTitle("---\ntitle:\n---\nflowchart TD\n  A[Cue] --> B")).toBe("Cue");
    expect(diagramTitle("---\ntitle: 'Loop'\n---\nflowchart TD\n  A[Cue] --> B")).toBe("Loop");
    expect(diagramTitle("flowchart TD\n  A --> B")).toBe("Diagram from the chat");
    expect(diagramTitle("mindmap\n  root((AI Engineering))\n    Foundations")).toBe("AI Engineering");
    expect(diagramTitle('flowchart TD\n  A["Query (attention)"] --> B["Keys"]')).toBe("Query (attention)");
    expect(diagramTitle("flowchart TD\n  A[X] --> B[Y]")).toBe("X");
    expect(diagramTitle("---\ntitle: Ignored\n---\n%% Attention flow\nflowchart TD\n  A[Q] --> B")).toBe("Attention flow");
    expect(diagramTitle("---\ntitle: Habit loop\n---\nflowchart TD\n  A[Cue] --> B")).toBe("Habit loop");
    expect(diagramTitle("---\nconfig:\n  theme: forest\n---\nflowchart TD\n  A[Cue] --> B")).toBe("Cue");
  });
});

describe("which chapter's board the reader means", () => {
  const toc = [
    { label: "Introduction", depth: 0 },
    { label: "Why habits", depth: 1 },
    { label: "Part one", depth: 0 },
    { label: "Introduction", depth: 0 },
    { label: "The loop", depth: 1 },
    { label: "Cues", depth: 2 },
  ];

  it("takes the sections from the chapter being read, even when another chapter has the same name", () => {
    expect(boardChapter(toc, 1, [])).toEqual({ chapter: "Introduction", labels: ["Introduction", "Why habits"] });
    expect(boardChapter(toc, 5, [])).toEqual({ chapter: "Introduction", labels: ["Introduction", "The loop", "Cues"] });
    expect(boardChapter(toc, 2, [])).toEqual({ chapter: "Part one", labels: ["Part one"] });
  });

  it("uses the Course chapter around the place when a Course reads the book", () => {
    expect(boardChapter(toc, 5, ["The loop"])).toEqual({ chapter: "The loop", labels: ["The loop", "Cues"] });
    expect(boardChapter(toc, 9, [])).toBeNull();
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
  const review = (ops: string) => `{"missing": [], "wrong_links": [], "question": "Why does the cue lead to the craving?", "ops": ${ops}}`;
  const ask = (provider: Provider, kind: "review" | "check" = "review") =>
    askAboutBoard(
      provider,
      {
        bookId,
        book: { title: "Atomic Habits", author: null },
        chapter: "Habits",
        labels: ["Habits"],
        scene,
        image: { mediaType: "image/png", data: "AAAA" },
        ask: { kind },
      },
      null,
      new AbortController().signal,
    );

  it("sends the chapter's own text, the board and its picture", async () => {
    const { provider, turns } = tutor([review('[{"op": "add_node", "id": "reward", "text": "Reward"}]')]);
    expect(await ask(provider)).toMatchObject({ kind: "review", review: { ops: [{ op: "add_node", id: "reward", text: "Reward" }] } });
    const message = turns[0].messages[0];
    expect(message.content).toContain("A cue triggers a craving");
    expect(message.content).not.toContain("Not this chapter.");
    expect(message.content).toContain('"id":"l1"');
    expect(message.content).toContain("Review this board.");
    expect(message.images).toEqual([{ mediaType: "image/png", data: "AAAA" }]);
  });

  it("sends a reply that can't be used back once with the reason, then gives up", async () => {
    const repaired = tutor([review('[{"op": "delete", "id": "n9"}]'), review('[{"op": "delete", "id": "n3"}]')]);
    expect(await ask(repaired.provider)).toMatchObject({ kind: "review", review: { ops: [{ op: "delete", id: "n3" }] } });
    expect(repaired.turns[1].messages.at(-1)!.content).toContain('"n9" is not on the board.');
    const hopeless = tutor(["nope", "still nope"]);
    await expect(ask(hopeless.provider, "check")).rejects.toThrow(/couldn't be read/);
    expect(hopeless.turns).toHaveLength(2);
  });
});

describe("a chat diagram on a board", () => {
  const board: CompactScene = {
    nodes: [
      { id: "n1", text: "Tokens", x: 0, y: 0 },
      { id: "n2", text: "Embeddings", x: 200, y: 0 },
    ],
    links: [{ id: "l1", from: "n1", to: "n2" }],
    loose: 0,
    sketches: 0,
  };

  it("reuses the ideas already drawn and adds only what is new", () => {
    const diagram: CompactScene = {
      nodes: [
        { id: "n1", text: "tokens", x: 900, y: 0 },
        { id: "n2", text: "Embeddings", x: 1100, y: 0 },
        { id: "n3", text: "Attention", x: 1300, y: 0 },
      ],
      links: [
        { id: "l1", from: "n1", to: "n2", label: "look up" },
        { id: "l2", from: "n2", to: "n3" },
      ],
      loose: 0,
      sketches: 0,
    };
    expect(diagramOps(diagram, board)).toEqual([
      { op: "add_node", id: "d1", text: "Attention", x: 1300, y: 0 },
      { op: "update", id: "l1", text: "look up" },
      { op: "add_link", from: "n2", to: "d1" },
    ]);
  });

  it("adds nothing for a diagram already on the board", () => {
    expect(diagramOps(board, board)).toEqual([]);
  });

  it("finds the board about the same thing, and none for another topic", () => {
    const boards = [
      { id: "a", title: "Autoregressive vs masked LMs: use cases" },
      { id: "b", title: "Attention heads" },
    ];
    expect(relatedBoard("%% Masked LMs in practice\nflowchart TD\n A[Masked LM] --> B[Classify]", boards)?.id).toBe("a");
    expect(relatedBoard("flowchart TD\n A[Query] --> B[Attention heads]", boards)?.id).toBe("b");
    expect(relatedBoard("flowchart TD\n A[Tokenizer] --> B[Vocabulary]", boards)).toBeNull();
  });
});
