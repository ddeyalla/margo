import { firstObject } from "./json";
import type { RecallItem } from "./mastery";
import { chapterOf, chapterSpan } from "./quiz";
import { recallAt, replaySchedule } from "./schedule";

/**
 * A chapter's whiteboard: an Excalidraw drawing the reader makes of the chapter, kept as a `.excalidraw` file in
 * the notes folder so Obsidian's Excalidraw plugin opens it too. The tutor never sees the drawing as Excalidraw
 * stores it. It gets a compact scene: the words on the board, where they sit, and which arrows join them. It
 * answers in the same short ids, and everything it sends back is checked here before the board shows it.
 */

/** One draw-it-back attempt: the board was redrawn from memory and checked. `correct` when no link was wrong. */
export interface BoardAttempt {
  at: string;
  correct: boolean;
}

/**
 * What the app keeps about one of a book's boards in the book's state. The drawing itself lives in the notes folder.
 * A book has any number of boards. One per chapter is that chapter's board, which draw-it-back is for; the rest are
 * the reader's own, made new or opened from a diagram in the chat.
 */
export interface Board {
  id: string;
  title: string;
  kind: "chapter" | "free";
  /** The chapter the board is about, which the tutor reads it against, or null when it was made outside any chapter. */
  chapter: string | null;
  /** The chapter and the sections under it, as its quiz and Course steps name them. */
  labels: string[];
  /** The board's file, relative to the notes folder, once it has been saved; it keeps its name if the title changes. */
  path: string | null;
  attempts: BoardAttempt[];
  /** For a board made from a diagram in the chat, a hash of the diagram, so opening it again opens the same board. */
  from?: string;
}

/** A board in the list: its entry, and when its file last changed, or null when it has none. */
export type BoardSummary = Board & { editedAt: string | null };

/** A short hash, the same in the browser and on the server. Not for security: it names things. */
export const shortHash = (text: string): string => {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x5bd1e995);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
};

/** A chapter board's id, worked out from the chapter, so the same chapter always names the same board. */
export const chapterBoardId = (chapter: string): string => `chapter-${shortHash(chapter)}`;

/** Board ids as the app makes them: a chapter's, or a new board's random one. */
export const isBoardId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9-]{8,64}$/.test(value);

/**
 * A board entry as stored. Entries saved before books had more than one board have only a chapter: they become
 * that chapter's board, with the id worked out from it, so reading them twice gives the same board.
 */
export const normalizeBoard = (raw: Partial<Board> & { chapter: string | null }): Board => {
  const chapter = raw.chapter ?? null;
  const kind = raw.kind ?? (raw.id ? "free" : "chapter");
  const board: Board = {
    id: raw.id ?? chapterBoardId(chapter ?? ""),
    title: raw.title ?? chapter ?? "Untitled board",
    kind,
    chapter,
    labels: raw.labels ?? (chapter ? [chapter] : []),
    path: raw.path ?? null,
    attempts: raw.attempts ?? [],
  };
  return raw.from ? { ...board, from: raw.from } : board;
};

/**
 * The title a chat diagram gives the board made from it: its first line when that is a Mermaid comment ("%% Attention
 * flow"), which the tutor writes when it draws for a board, or else its first label.
 */
export const diagramTitle = (source: string): string => {
  const first = source.trimStart().split("\n", 1)[0];
  const comment = /^%%(?!\{)\s*(.+)$/.exec(first)?.[1]?.trim();
  if (comment) return comment.slice(0, 120);
  const body = source.replace(/^\s*%%.*$/gm, "");
  const label = /[[({>]+"?([^[({\])}"\n]{2,60})"?[\])}]/.exec(body)?.[1]?.trim();
  return label || "Diagram from the chat";
};

/** An empty board, as its first file holds it until the reader draws. */
export const EMPTY_BOARD = JSON.stringify({ type: "excalidraw", version: 2, source: "rigg-learn", elements: [], appState: {}, files: {} }, null, 2);

/** A board as opened: its file's text and the hash a save must start from. */
export interface BoardVersion {
  text: string;
  hash: string;
}

export interface OpenedBoard {
  board: Board;
  /** Null when there is no file yet, or it was removed. */
  file: BoardVersion | null;
}

export type BoardSave =
  | { state: "saved"; path: string; hash: string }
  /** The file changed since it was opened. It was left alone; this save is in `copy`, and `current` is the file now. */
  | { state: "conflict"; path: string; copy: string; current: BoardVersion | null };

/** The most a saved board may weigh. Pasted images are what make boards big. */
export const MAX_BOARD_BYTES = 20_000_000;

/** Whether the text is a board as Excalidraw saves it: `{ "type": "excalidraw", "elements": [...] }`, within the size limit. */
export const isBoardFile = (text: string): boolean => {
  if (text.length > MAX_BOARD_BYTES) return false;
  try {
    const value = JSON.parse(text) as { type?: unknown; elements?: unknown };
    return value?.type === "excalidraw" && Array.isArray(value.elements);
  } catch {
    return false;
  }
};

/* The compact scene. */

/** The parts of an Excalidraw element the compact scene reads. Excalidraw's own elements fit it. */
export interface BoardElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  text?: string;
  originalText?: string;
  containerId?: string | null;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  customData?: Record<string, unknown>;
}

export interface SceneNode {
  id: string;
  text: string;
  x: number;
  y: number;
}

export interface SceneLink {
  id: string;
  from: string;
  to: string;
  label?: string;
}

/** The board as the tutor reads it. */
export interface CompactScene {
  nodes: SceneNode[];
  links: SceneLink[];
  /** Arrows with an end not attached to anything: drawn, but not a link between two ideas. */
  loose: number;
  /** Freehand strokes, lines and pictures, which carry no words. */
  sketches: number;
}

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);
const SKETCHES = new Set(["freedraw", "line", "image"]);
export const MAX_TEXT = 200;

const clean = (text: string | undefined) => (text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);

/** Whether an element is one of the tutor's suggestions, not the reader's own drawing. */
export const isSuggestion = (element: Pick<BoardElement, "customData">): boolean => typeof element.customData?.suggestion === "string";

/**
 * The reader's drawing as a compact scene, and which element each short id stands for. Boxes, ellipses, diamonds
 * and free text are nodes; arrows attached at both ends are links. Suggestions the reader hasn't accepted are not
 * part of their drawing and are left out.
 */
export const compactScene = (elements: readonly BoardElement[]): { scene: CompactScene; ids: Record<string, string> } => {
  const live = elements.filter((element) => !element.isDeleted && !isSuggestion(element));
  const textIn = new Map<string, string>();
  for (const element of live) if (element.type === "text" && element.containerId) textIn.set(element.containerId, clean(element.originalText ?? element.text));

  const shapes = live
    .filter((element) => SHAPES.has(element.type) || (element.type === "text" && !element.containerId))
    .sort((a, b) => Math.round(a.y / 40) - Math.round(b.y / 40) || a.x - b.x);
  const ids: Record<string, string> = {};
  const nodeOf = new Map<string, string>();
  const nodes = shapes.map((element, i): SceneNode => {
    const id = `n${i + 1}`;
    ids[id] = element.id;
    nodeOf.set(element.id, id);
    const text = element.type === "text" ? clean(element.originalText ?? element.text) : (textIn.get(element.id) ?? "");
    return { id, text, x: Math.round(element.x), y: Math.round(element.y) };
  });

  const links: SceneLink[] = [];
  let loose = 0;
  for (const element of live) {
    if (element.type !== "arrow") continue;
    const from = element.startBinding && nodeOf.get(element.startBinding.elementId);
    const to = element.endBinding && nodeOf.get(element.endBinding.elementId);
    if (!from || !to) {
      loose++;
      continue;
    }
    const id = `l${links.length + 1}`;
    ids[id] = element.id;
    const label = textIn.get(element.id);
    links.push(label ? { id, from, to, label } : { id, from, to });
  }
  const sketches = live.filter((element) => SKETCHES.has(element.type)).length;
  return { scene: { nodes, links, loose, sketches }, ids };
};

const COORDINATE = 100_000;
const coordinate = (value: unknown): number | undefined | null =>
  value === undefined ? undefined : typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= COORDINATE ? Math.round(value) : null;

const MAX_NODES = 400;
const MAX_LINKS = 800;
const count = (value: unknown) => (Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null);

/** A compact scene sent from the page, checked before it goes into a prompt: well-formed ids, and links between its own nodes. */
export const parseCompactScene = (value: unknown): CompactScene | null => {
  if (typeof value !== "object" || value === null) return null;
  const { nodes, links, loose, sketches } = value as Record<string, unknown>;
  if (!Array.isArray(nodes) || !Array.isArray(links) || nodes.length > MAX_NODES || links.length > MAX_LINKS) return null;
  const scene: CompactScene = { nodes: [], links: [], loose: count(loose) ?? 0, sketches: count(sketches) ?? 0 };
  const ids = new Set<string>();
  for (const raw of nodes) {
    const node = (raw ?? {}) as Record<string, unknown>;
    if (typeof node.id !== "string" || !/^n\d{1,4}$/.test(node.id) || ids.has(node.id)) return null;
    if (typeof node.text !== "string" || coordinate(node.x) == null || coordinate(node.y) == null) return null;
    ids.add(node.id);
    scene.nodes.push({ id: node.id, text: clean(node.text), x: coordinate(node.x)!, y: coordinate(node.y)! });
  }
  for (const raw of links) {
    const link = (raw ?? {}) as Record<string, unknown>;
    if (typeof link.id !== "string" || !/^l\d{1,4}$/.test(link.id) || ids.has(link.id)) return null;
    if (typeof link.from !== "string" || typeof link.to !== "string" || !ids.has(link.from) || !ids.has(link.to)) return null;
    if (link.label !== undefined && typeof link.label !== "string") return null;
    ids.add(link.id);
    const label = clean(link.label as string | undefined);
    scene.links.push(label ? { id: link.id, from: link.from, to: link.to, label } : { id: link.id, from: link.from, to: link.to });
  }
  return scene;
};

/* The tutor's edits. */

/**
 * One change the tutor proposes. Nothing is applied as sent: each becomes a suggestion the reader accepts or
 * rejects. New nodes take ids of the tutor's choosing so its links can point at them in the same reply.
 */
export type BoardOp =
  | { op: "add_node"; id: string; text: string; x?: number; y?: number }
  | { op: "add_link"; from: string; to: string; label?: string }
  | { op: "update"; id: string; text: string }
  | { op: "delete"; id: string };

export const MAX_OPS = 60;
const NEW_ID = /^[a-z][a-z0-9_-]{0,23}$/;

const text = (value: unknown, max = MAX_TEXT): string | null => (typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim().slice(0, max) : null);

/**
 * The tutor's ops, checked against the scene they were written for. Returns them, or the reason they can't be
 * used, worded for the tutor to fix: every id it names must be on the board or added earlier in the same list,
 * new ids must be new, and nothing is both changed and removed.
 */
export const validateOps = (value: unknown, scene: CompactScene): BoardOp[] | string => {
  if (!Array.isArray(value)) return '"ops" must be a list.';
  if (value.length > MAX_OPS) return `Send at most ${MAX_OPS} ops; the reply had ${value.length}.`;
  const nodes = new Set(scene.nodes.map((node) => node.id));
  const links = new Set(scene.links.map((link) => link.id));
  const added = new Set<string>();
  const touched = new Set<string>();
  const removed = new Set<string>();
  const ops: BoardOp[] = [];
  for (const [i, raw] of value.entries()) {
    const at = `Op ${i + 1}`;
    if (typeof raw !== "object" || raw === null) return `${at} is not an object.`;
    const item = raw as Record<string, unknown>;
    if (item.op === "add_node") {
      const id = item.id;
      if (typeof id !== "string" || !NEW_ID.test(id)) return `${at}: a new node's "id" is a short lowercase name such as "habit".`;
      if (nodes.has(id) || links.has(id) || added.has(id)) return `${at}: "${id}" is already taken; give the new node an id of its own.`;
      const label = text(item.text);
      if (!label) return `${at}: a new node needs its "text".`;
      const x = coordinate(item.x);
      const y = coordinate(item.y);
      if (x === null || y === null) return `${at}: "x" and "y" are numbers within ±${COORDINATE}, or left out.`;
      added.add(id);
      ops.push({ op: "add_node", id, text: label, ...(x === undefined ? {} : { x }), ...(y === undefined ? {} : { y }) });
    } else if (item.op === "add_link") {
      const { from, to } = item;
      for (const end of [from, to]) {
        if (typeof end !== "string" || !(nodes.has(end) || added.has(end))) return `${at}: "${String(end)}" is not a node on the board or one added above.`;
        if (removed.has(end)) return `${at}: "${end}" is being removed, so it can't be linked.`;
      }
      if (from === to) return `${at}: a link joins two different nodes.`;
      const label = item.label === undefined ? null : text(item.label);
      ops.push({ op: "add_link", from: from as string, to: to as string, ...(label ? { label } : {}) });
    } else if (item.op === "update" || item.op === "delete") {
      const id = item.id;
      if (typeof id !== "string" || !(nodes.has(id) || links.has(id))) return `${at}: "${String(id)}" is not on the board.`;
      if (touched.has(id)) return `${at}: "${id}" already has a change; send one change per node or link.`;
      touched.add(id);
      if (item.op === "delete") {
        removed.add(id);
        ops.push({ op: "delete", id });
      } else {
        const label = text(item.text);
        if (!label) return `${at}: an update needs the new "text".`;
        ops.push({ op: "update", id, text: label });
      }
    } else {
      return `${at}: "op" must be "add_node", "add_link", "update" or "delete".`;
    }
  }
  /* A link added earlier to a node removed later would dangle. */
  for (const op of ops) if (op.op === "add_link" && (removed.has(op.from) || removed.has(op.to))) return `A new link ends at "${removed.has(op.from) ? op.from : op.to}", which is being removed.`;
  return ops;
};

const parseObject = (reply: string): Record<string, unknown> | string => {
  const json = firstObject(reply);
  if (!json) return "The reply had no JSON object.";
  try {
    const value = JSON.parse(json) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : "The reply must be a JSON object.";
  } catch (error) {
    return `The JSON did not parse: ${error instanceof Error ? error.message : "unknown error"}.`;
  }
};

/* The board in the chat. */

/** How ops are written, for any prompt that asks the tutor for them. */
export const BOARD_OPS_GUIDE = `Ops change the board. The reader sees each one as a suggestion in its own colour and accepts or rejects it; nothing you send replaces their drawing.
- {"op": "add_node", "id": "habit-loop", "text": "Habit loop", "x": 420, "y": 160} adds an idea. The id is a short lowercase name of your own. Leave out x and y to let the app place it.
- {"op": "add_link", "from": "n2", "to": "habit-loop", "label": "builds"} adds an arrow between two nodes on the board or added above. The label is optional.
- {"op": "update", "id": "n3", "text": "..."} rewords a node, or a link's label.
- {"op": "delete", "id": "l2"} removes a node or link.
Nodes on the board are n1, n2…; links are l1, l2…, as the board JSON lists them.`;

/**
 * The whiteboard a chat message is about, as the reader sent it: the board, its compact scene at that moment, and
 * which element each short id stood for then. The tutor's changes in the answer are read against this scene and
 * placed through these ids, never the board as it is later, so an edit made meanwhile can't make n3 mean another box.
 */
export interface BoardMention {
  id: string;
  title: string;
  scene: CompactScene;
  ids: Record<string, string>;
}

const ELEMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A board mention sent from the page: a board id, a title, a well-formed scene, and an element id for each of its ids. */
export const parseBoardMention = (value: unknown): BoardMention | null => {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const title = text(raw.title, 200);
  const scene = parseCompactScene(raw.scene);
  if (!isBoardId(raw.id) || !title || !scene || typeof raw.ids !== "object" || raw.ids === null) return null;
  const given = raw.ids as Record<string, unknown>;
  const wanted = [...scene.nodes.map((node) => node.id), ...scene.links.map((link) => link.id)];
  if (Object.keys(given).length !== wanted.length) return null;
  const ids: Record<string, string> = {};
  for (const id of wanted) {
    const element = given[id];
    if (typeof element !== "string" || !ELEMENT_ID.test(element)) return null;
    ids[id] = element;
  }
  return { id: raw.id, title, scene, ids };
};

/** The language of the fence an answer puts its board changes in. */
export const BOARD_FENCE = "board";

/**
 * The changes an answer makes to the board its question was about: the last ```board fence, a JSON list of ops (or
 * an object holding one as "ops"), checked against the scene that was sent. Null when the answer has no such fence;
 * the reason, when it has one that can't be used.
 */
export const boardOpsIn = (answer: string, scene: CompactScene): BoardOp[] | string | null => {
  const fences = [...answer.matchAll(/```board[ \t]*\n([\s\S]*?)```/g)];
  const body = fences.at(-1)?.[1];
  if (body === undefined) return null;
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return "The changes to the board weren't valid JSON.";
  }
  const ops = validateOps(Array.isArray(value) ? value : (value as { ops?: unknown } | null)?.ops, scene);
  if (typeof ops === "string") return ops;
  return ops.length ? ops : null;
};

/* A diagram from the chat, put on a board that already exists. */

const sameWords = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * The ops that put a diagram on a board without drawing anything twice. An idea already on the board, by its words,
 * is reused, so a diagram that expands or corrects the board adds only what is new: new ideas where the diagram had
 * them, new links, and new wording for a link the board already has. Nothing on the board is removed.
 */
export const diagramOps = (diagram: CompactScene, board: CompactScene): BoardOp[] => {
  const onBoard = new Map<string, string>();
  for (const node of board.nodes) {
    const key = sameWords(node.text);
    if (key && !onBoard.has(key)) onBoard.set(key, node.id);
  }
  const ref = new Map<string, string>();
  const ops: BoardOp[] = [];
  let made = 0;
  for (const node of diagram.nodes) {
    const key = sameWords(node.text);
    if (!key) continue;
    const existing = onBoard.get(key);
    if (existing) {
      ref.set(node.id, existing);
      continue;
    }
    const id = `d${++made}`;
    onBoard.set(key, id);
    ref.set(node.id, id);
    ops.push({ op: "add_node", id, text: node.text, x: node.x, y: node.y });
  }
  const links = new Map(board.links.map((link) => [`${link.from}>${link.to}`, link]));
  for (const link of diagram.links) {
    const from = ref.get(link.from);
    const to = ref.get(link.to);
    if (!from || !to || from === to) continue;
    const existing = links.get(`${from}>${to}`);
    if (existing) {
      if (link.label && link.label !== existing.label && !ops.some((op) => op.op === "update" && op.id === existing.id)) ops.push({ op: "update", id: existing.id, text: link.label });
      continue;
    }
    links.set(`${from}>${to}`, { id: "", from, to });
    ops.push({ op: "add_link", from, to, ...(link.label ? { label: link.label } : {}) });
  }
  return ops;
};

const MERMAID_WORDS = new Set(["graph", "flowchart", "subgraph", "end", "classdef", "class", "style", "linkstyle", "click", "direction"]);
const STOP_WORDS = new Set(["the", "and", "for", "with", "from", "into", "that", "this", "are", "how", "what", "why", "when", "its", "not", "but", "can", "use", "uses", "used", "via", "per", "you", "your", "our", "out", "vs"]);
const topicWords = (text: string): Set<string> =>
  new Set((sameWords(text).match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((word) => !MERMAID_WORDS.has(word) && !STOP_WORDS.has(word)));

/**
 * The board a chat diagram most likely belongs on, by the words its title shares with the diagram: at least two of
 * them, or all of a short title's. Null when no board is about the same thing, and the diagram gets a board of its own.
 */
export const relatedBoard = <B extends Pick<Board, "id" | "title">>(source: string, boards: readonly B[]): B | null => {
  const drawn = topicWords(`${diagramTitle(source)} ${source.replace(/^\s*%%.*$/gm, "")}`);
  let best: { board: B; score: number } | null = null;
  for (const board of boards) {
    const title = topicWords(board.title);
    if (!title.size) continue;
    const shared = [...title].filter((word) => drawn.has(word)).length;
    if (shared < Math.min(2, title.size)) continue;
    const score = shared / title.size + shared / 10;
    if (!best || score > best.score) best = { board, score };
  }
  return best?.board ?? null;
};

/** The tutor's read of a board drawn with the book open. */
export interface BoardReview {
  /** Ideas from the chapter the board leaves out. */
  missing: string[];
  /** Links that say something the chapter doesn't, by link id, with why. */
  wrongLinks: { link: string; why: string }[];
  /** One question about a link on the board: why does A lead to B? */
  question: string;
  /** The missing ideas and fixes, as suggestions. */
  ops: BoardOp[];
}

const MAX_MISSING = 8;

export const parseReviewReply = (reply: string, scene: CompactScene): BoardReview | string => {
  const value = parseObject(reply);
  if (typeof value === "string") return value;
  const missing = Array.isArray(value.missing) ? value.missing.map((item) => text(item)).filter((item): item is string => !!item).slice(0, MAX_MISSING) : null;
  if (!missing) return '"missing" must be a list of the chapter\'s ideas the board leaves out (it can be empty).';
  if (!Array.isArray(value.wrong_links)) return '"wrong_links" must be a list (it can be empty).';
  const links = new Set(scene.links.map((link) => link.id));
  const wrongLinks: BoardReview["wrongLinks"] = [];
  for (const item of value.wrong_links as unknown[]) {
    const link = (item as { link?: unknown } | null)?.link;
    const why = text((item as { why?: unknown } | null)?.why, 600);
    if (typeof link !== "string" || !links.has(link)) return `"${String(link)}" in "wrong_links" is not a link on the board.`;
    if (!why) return `Say "why" each wrong link is wrong.`;
    wrongLinks.push({ link, why });
  }
  const question = text(value.question, 600);
  if (!question) return 'Ask one "question" about a link on the board.';
  const ops = validateOps(value.ops ?? [], scene);
  if (typeof ops === "string") return ops;
  return { missing, wrongLinks, question, ops };
};

/** The tutor's check of a board redrawn from memory: the first wrong link, or none. Never a grade. */
export interface BoardCheck {
  wrong: { link: string; hint: string } | null;
  note: string;
}

export const parseCheckReply = (reply: string, scene: CompactScene): BoardCheck | string => {
  const value = parseObject(reply);
  if (typeof value === "string") return value;
  const note = text(value.note, 600);
  if (!note) return 'Add a one-sentence "note".';
  if (value.wrong === null) return { wrong: null, note };
  const link = (value.wrong as { link?: unknown } | undefined)?.link;
  const hint = text((value.wrong as { hint?: unknown } | undefined)?.hint, 600);
  if (typeof link !== "string" || !scene.links.some((l) => l.id === link)) return `"wrong" must be null or name a link on the board, such as {"link": "${scene.links[0]?.id ?? "l1"}", "hint": "..."}.`;
  if (!hint) return 'Give a "hint" that points the reader back to the chapter without the answer.';
  return { wrong: { link, hint }, note };
};

/* Retention. */

/**
 * How well the reader can still redraw a chapter: each draw-it-back with no wrong link counts as a right answer,
 * each with one as a wrong answer, replayed like quiz answers so the board fades and firms up as cards do.
 */
export const boardRecall = (board: Pick<Board, "attempts">, now: Date): RecallItem | null => {
  const schedule = replaySchedule(board.attempts);
  const recall = schedule && recallAt(schedule, now);
  return recall === null || recall === undefined ? null : { recall, weight: 1 };
};

/** What the tutor said about a board, as the route answers it. A check also returns the board's attempts. */
export type BoardAnswer =
  | { kind: "review"; review: BoardReview }
  | { kind: "check"; check: BoardCheck; attempts?: BoardAttempt[] };

/**
 * Which chapter's board the reader means at a place in the book: the Course chapter around it when a Course reads
 * this book, so the board counts toward that Course, or else the top-level chapter it is in. With the sections
 * under it, as a quiz names them.
 */
export const boardChapter = (
  toc: readonly { label: string; depth: number }[],
  index: number,
  courseChapters: readonly string[],
): { chapter: string; labels: string[] } | null => {
  if (index < 0 || index >= toc.length) return null;
  const chapter = chapterOf(toc, index, courseChapters) ?? (() => {
    let at = index;
    while (at > 0 && toc[at].depth > 0) at--;
    return toc[at].label;
  })();
  return { chapter, labels: chapterSpan(toc, chapter)?.labels ?? [chapter] };
};
