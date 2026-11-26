import { convertToExcalidrawElements, getCommonBounds, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawArrowElement, ExcalidrawElement, ExcalidrawTextElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { BoardOp } from "@/lib/shared/boards";
import { anchoredX, arrowBetween, boundsOf, NODE, placeNodes, wrapWords, type Box, type TextAlign } from "./geometry";

/**
 * The tutor's changes as suggestions on the canvas: drawn in their own colour, dashed and locked, and tagged in
 * `customData` with what they would do. The reader's own elements are never touched until a suggestion is
 * accepted: a new idea or link is added beside them, a rewording shows as a note under its target, and a removal
 * as an outline around it. Everything about a suggestion lives on its elements, so undo and redo keep the list
 * of suggestions right without any state of its own.
 */

export const SUGGESTION_COLOR = "#7048e8";
const READER_COLOR = "#1e1e1e";

export type SuggestionKind = BoardOp["op"];

interface SuggestionData {
  suggestion: string;
  kind: SuggestionKind;
  /** What it does, in the reader's words: Add “Reward”. */
  label: string;
  /** The reader's element an update or removal is about. */
  target?: string;
  /** The ends of a new link. */
  from?: string;
  to?: string;
  /** An update's new words. */
  text?: string;
}

type Element = ExcalidrawElement;

const dataOf = (element: Element): SuggestionData | null =>
  typeof element.customData?.suggestion === "string" ? (element.customData as SuggestionData) : null;

const boxOf = (element: Element): Box => {
  const [x1, y1, x2, y2] = getCommonBounds([element]);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
};

const live = (elements: readonly Element[]) => elements.filter((element) => !element.isDeleted);

/** The words an element shows: its own text, or its bound label's. */
export const wordsOf = (element: Element, elements: readonly Element[]): string => {
  if (element.type === "text") return element.originalText || element.text;
  const label = elements.find((e): e is ExcalidrawTextElement => e.type === "text" && !e.isDeleted && e.containerId === element.id);
  return label?.originalText || label?.text || "";
};

const quoted = (text: string) => `“${text.length > 40 ? `${text.slice(0, 39)}…` : text}”`;
const nameOf = (element: Element, elements: readonly Element[]) => {
  const words = wordsOf(element, elements).replace(/\s+/g, " ").trim();
  return words ? quoted(words) : element.type === "arrow" ? "this link" : "this shape";
};

/* Roughly how wide the hand font draws a character at the board's size, and how tall a line is. */
const CHAR = 10;
const LINE = 25;

/** A box big enough for its words: wider for a long label, up to a limit, then taller. */
const nodeSize = (text: string) => {
  const width = Math.min(320, Math.max(NODE.width, Math.ceil(text.length / 2) * CHAR + 30));
  const lines = Math.ceil((text.length * CHAR) / (width - 30));
  return { width, height: Math.max(NODE.height, lines * LINE + 20) };
};

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);

const tag = (elements: readonly Element[], data: SuggestionData): Element[] => elements.map((element) => newElementWith(element, { locked: true, customData: data }));

const style = { strokeColor: SUGGESTION_COLOR, strokeStyle: "dashed", roughness: 1 } as const;

/**
 * The tutor's ops as suggestion elements to add to the board. `ids` maps the compact scene's ids to the elements
 * they stood for when the scene was sent; ops about anything the reader has removed since are dropped.
 */
export const suggestionsFor = (ops: readonly BoardOp[], ids: Record<string, string>, elements: readonly Element[]): { added: Element[]; dropped: number } => {
  const byId = new Map(live(elements).map((element) => [element.id, element]));
  const reader = (ref: string) => {
    const id = ids[ref];
    return id ? byId.get(id) : undefined;
  };
  /* New ideas first, so links can find them: placed where the tutor said, or beside what they link to. */
  const newNodes = new Map<string, { id: string; box: Box }>();
  const board = boundsOf(live(elements).map(boxOf));
  const sizes = new Map(ops.flatMap((op) => (op.op === "add_node" ? [[op.id, nodeSize(op.text)] as const] : [])));
  const unplaced = ops.filter((op): op is Extract<BoardOp, { op: "add_node" }> => op.op === "add_node" && (op.x === undefined || op.y === undefined));
  const positions = placeNodes(
    unplaced.map((op) => {
      const link = ops.find((o) => o.op === "add_link" && (o.from === op.id || o.to === op.id)) as Extract<BoardOp, { op: "add_link" }> | undefined;
      const other = link && (link.from === op.id ? link.to : link.from);
      const near = other ? reader(other) : undefined;
      /* Stacked by the element they sit beside, each taking the height its words need. */
      return { id: op.id, near: near ? boxOf(near) : null, key: near?.id, size: sizes.get(op.id) };
    }),
    board,
  );

  const added: Element[] = [];
  let dropped = 0;
  for (const op of ops) {
    const suggestion = newId();
    if (op.op === "add_node") {
      /* A coordinate the tutor gave is kept even when the other one was left to the app. */
      const placed = positions.get(op.id);
      const at = { x: op.x ?? placed!.x, y: op.y ?? placed!.y };
      const id = newId();
      const size = sizes.get(op.id)!;
      const skeleton: ExcalidrawElementSkeleton = { type: "rectangle", id, ...at, ...size, ...style, roundness: { type: 3 }, label: { text: op.text, strokeColor: SUGGESTION_COLOR } };
      /* Keep the id: links to this idea are drawn against it. */
      added.push(...tag(convertToExcalidrawElements([skeleton], { regenerateIds: false }), { suggestion, kind: "add_node", label: `Add ${quoted(op.text)}` }));
      newNodes.set(op.id, { id, box: { ...at, ...size } });
      continue;
    }
    if (op.op === "add_link") {
      const end = (ref: string) => {
        const made = newNodes.get(ref);
        if (made) return made;
        const element = reader(ref);
        return element ? { id: element.id, box: boxOf(element) } : null;
      };
      const from = end(op.from);
      const to = end(op.to);
      if (!from || !to) {
        dropped++;
        continue;
      }
      const name = (ref: string, id: string) => {
        const element = byId.get(id);
        if (element) return nameOf(element, elements);
        const made = ops.find((o) => o.op === "add_node" && o.id === ref) as Extract<BoardOp, { op: "add_node" }> | undefined;
        return made ? quoted(made.text) : "a new idea";
      };
      const arrow = arrowBetween(from.box, to.box);
      const [dx, dy] = arrow.points[1];
      const skeleton: ExcalidrawElementSkeleton = {
        type: "arrow",
        x: arrow.x,
        y: arrow.y,
        width: Math.abs(dx),
        height: Math.abs(dy),
        points: arrow.points as never,
        ...style,
        ...(op.label ? { label: { text: op.label, strokeColor: SUGGESTION_COLOR } } : {}),
      };
      const label = `Link ${name(op.from, from.id)} → ${name(op.to, to.id)}${op.label ? ` (${op.label})` : ""}`;
      added.push(...tag(convertToExcalidrawElements([skeleton]), { suggestion, kind: "add_link", label, from: from.id, to: to.id }));
      continue;
    }
    const target = reader(op.id);
    if (!target) {
      dropped++;
      continue;
    }
    const box = boxOf(target);
    if (op.op === "update") {
      const skeleton: ExcalidrawElementSkeleton = { type: "text", x: box.x, y: box.y + box.height + 10, text: `→ ${op.text}`, fontSize: 16, strokeColor: SUGGESTION_COLOR };
      const label = `Change ${nameOf(target, elements)} to ${quoted(op.text)}`;
      added.push(...tag(convertToExcalidrawElements([skeleton]), { suggestion, kind: "update", label, target: target.id, text: op.text }));
    } else {
      const pad = 10;
      const skeleton: ExcalidrawElementSkeleton = { type: "rectangle", x: box.x - pad, y: box.y - pad, width: box.width + 2 * pad, height: box.height + 2 * pad, ...style, backgroundColor: "transparent" };
      added.push(...tag(convertToExcalidrawElements([skeleton]), { suggestion, kind: "delete", label: `Remove ${nameOf(target, elements)}`, target: target.id }));
    }
  }
  return { added, dropped };
};

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  label: string;
  /** The first element drawn for it, to bring it into view. */
  elementId: string;
}

/** The suggestions on the board, in the order they arrived. */
export const pendingSuggestions = (elements: readonly Element[]): Suggestion[] => {
  const seen = new Map<string, Suggestion>();
  for (const element of live(elements)) {
    const data = dataOf(element);
    if (data && !seen.has(data.suggestion)) seen.set(data.suggestion, { id: data.suggestion, kind: data.kind, label: data.label, elementId: element.id });
  }
  return [...seen.values()];
};

/** The reader's own elements: everything but suggestions. What is saved, and what a save is triggered by. */
export const readerElements = (elements: readonly Element[]) => elements.filter((element) => !dataOf(element));

const replace = (elements: readonly Element[], changed: ReadonlyMap<string, Element>, extra: readonly Element[] = []) => [
  ...elements.map((element) => changed.get(element.id) ?? element),
  ...extra,
];

const groupOf = (elements: readonly Element[], suggestion: string) => live(elements).filter((element) => dataOf(element)?.suggestion === suggestion);

/** Removes a suggestion, and any new link that hung on a new idea being removed with it. */
export const rejectSuggestion = (elements: readonly Element[], suggestion: string): Element[] => {
  const group = groupOf(elements, suggestion);
  const changed = new Map(group.map((element) => [element.id, newElementWith(element, { isDeleted: true })]));
  const data = group[0] && dataOf(group[0]);
  if (data?.kind === "add_node") {
    const removed = new Set(group.map((element) => element.id));
    for (const element of live(elements)) {
      const link = dataOf(element);
      if (link?.kind === "add_link" && (removed.has(link.from!) || removed.has(link.to!))) changed.set(element.id, newElementWith(element, { isDeleted: true }));
    }
  }
  return replace(elements, changed);
};

/**
 * A label in the reader's colour for `target`, measured and placed as Excalidraw would for that shape, and the size the
 * shape must grow to when the words wrap to more lines than fit it. A label that fits leaves the shape as it is.
 */
const labelFor = (target: Element, text: string): { label: ExcalidrawTextElement; size: { width: number; height: number } } => {
  const skeleton =
    target.type === "arrow"
      ? ({ type: "arrow", x: target.x, y: target.y, points: target.points as never, label: { text } } satisfies ExcalidrawElementSkeleton)
      : ({ type: target.type as "rectangle", x: target.x, y: target.y, width: target.width, height: target.height, label: { text } } satisfies ExcalidrawElementSkeleton);
  const made = convertToExcalidrawElements([skeleton]);
  const label = made.find((element) => element.type === "text") as ExcalidrawTextElement;
  const shape = target.type === "arrow" ? undefined : made.find((element) => element.type !== "text");
  return {
    label: newElementWith(label, { containerId: target.id, strokeColor: READER_COLOR }),
    size: { width: Math.max(target.width, shape?.width ?? 0), height: Math.max(target.height, shape?.height ?? 0) },
  };
};

/** How wide `text` draws in `like`'s font, and how tall. */
const measure = (like: ExcalidrawTextElement, text: string) => {
  const [made] = convertToExcalidrawElements([
    { type: "text", x: 0, y: 0, text, fontSize: like.fontSize, fontFamily: like.fontFamily, lineHeight: like.lineHeight, textAlign: like.textAlign },
  ]) as ExcalidrawTextElement[];
  return made;
};

/**
 * A text element with new words, measured in its own font and kept where it was by its alignment. Text the reader
 * gave a fixed width keeps that width, its words wrapped to it.
 */
const reworded = (target: ExcalidrawTextElement, words: string): ExcalidrawTextElement => {
  const fixed = target.autoResize === false;
  const text = !fixed ? words : wrapWords(words, target.width, (line) => measure(target, line).width);
  const made = measure(target, text);
  const width = !fixed ? made.width : target.width;
  return newElementWith(target, { text: made.text, originalText: words, width, height: made.height, x: anchoredX(target.x, target.width, width, target.textAlign as TextAlign) });
};

/** Makes a suggestion the reader's own: in their colour, unlocked, attached where it points. */
export const acceptSuggestion = (elements: readonly Element[], suggestion: string): Element[] => {
  const group = groupOf(elements, suggestion);
  const data = group[0] && dataOf(group[0]);
  if (!data) return [...elements];
  const changed = new Map<string, Element>();
  const extra: Element[] = [];
  const current = (id: string) => changed.get(id) ?? elements.find((element) => element.id === id);
  const own = (element: Element) =>
    newElementWith(element, { locked: false, customData: undefined, strokeColor: READER_COLOR, strokeStyle: "solid" } as Partial<Element>);

  if (data.kind === "add_node" || data.kind === "add_link") {
    let next = [...elements];
    /* A link to a new idea brings the idea with it. */
    if (data.kind === "add_link") {
      for (const end of [data.from!, data.to!]) {
        const pending = current(end) && dataOf(current(end)!);
        if (pending?.kind === "add_node") next = acceptSuggestion(next, pending.suggestion);
      }
    }
    const fresh = (id: string) => next.find((element) => element.id === id && !element.isDeleted);
    /* A link whose end the reader has removed since has nothing left to join. */
    if (data.kind === "add_link" && (!fresh(data.from!) || !fresh(data.to!))) return rejectSuggestion(next, suggestion);
    const updates = new Map<string, Element>();
    for (const element of groupOf(next, suggestion)) updates.set(element.id, own(element));
    if (data.kind === "add_link") {
      const arrow = group.find((element): element is ExcalidrawArrowElement => element.type === "arrow")!;
      /* Drawn again between the ends where they are now: the reader may have moved either since it was proposed. Its
         label moves with its middle. */
      const path = arrowBetween(fresh(data.from!)!, fresh(data.to!)!);
      const [dx, dy] = path.points[1];
      const [ox, oy] = arrow.points[arrow.points.length - 1] ?? [0, 0];
      const shift = { x: path.x + dx / 2 - (arrow.x + ox / 2), y: path.y + dy / 2 - (arrow.y + oy / 2) };
      updates.set(
        arrow.id,
        newElementWith(updates.get(arrow.id)!, {
          ...path,
          width: Math.abs(dx),
          height: Math.abs(dy),
          startBinding: { elementId: data.from!, focus: 0, gap: 6 },
          endBinding: { elementId: data.to!, focus: 0, gap: 6 },
        } as Partial<Element>),
      );
      for (const label of group.filter((element) => element.type === "text" && element.containerId === arrow.id)) {
        const owned = updates.get(label.id) ?? label;
        updates.set(label.id, newElementWith(owned, { x: owned.x + shift.x, y: owned.y + shift.y }));
      }
      for (const end of [data.from!, data.to!]) {
        const element = fresh(end)!;
        updates.set(end, newElementWith(element, { boundElements: [...(element.boundElements ?? []), { id: arrow.id, type: "arrow" }] }));
      }
    }
    return replace(next, updates);
  }

  for (const element of group) changed.set(element.id, newElementWith(element, { isDeleted: true }));
  const target = current(data.target!);
  if (!target || target.isDeleted) return replace(elements, changed);
  const bound = live(elements).find((element) => element.type === "text" && element.containerId === target.id);

  if (data.kind === "update") {
    if (target.type === "text") {
      /* Reworded in place, so its id, the arrows bound to it and the rest of its style stay as they are. */
      changed.set(target.id, reworded(target, data.text!));
    } else {
      const { label, size } = labelFor(target, data.text!);
      if (bound) changed.set(bound.id, newElementWith(bound, { isDeleted: true }));
      const others = (target.boundElements ?? []).filter((b) => b.id !== bound?.id);
      changed.set(target.id, newElementWith(target, { ...size, boundElements: [...others, { id: label.id, type: "text" }] }));
      extra.push(label);
    }
    return replace(elements, changed, extra);
  }

  /* A removal takes the target's label with it, and lets go of arrows attached to it. */
  changed.set(target.id, newElementWith(target, { isDeleted: true }));
  if (bound) changed.set(bound.id, newElementWith(bound, { isDeleted: true }));
  for (const element of live(elements)) {
    if (element.type !== "arrow" || changed.has(element.id)) continue;
    const start = element.startBinding?.elementId === target.id;
    const end = element.endBinding?.elementId === target.id;
    if (start || end) changed.set(element.id, newElementWith(element, { ...(start ? { startBinding: null } : {}), ...(end ? { endBinding: null } : {}) }));
  }
  return replace(elements, changed);
};
