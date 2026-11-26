/* Where things go on a board, kept apart from Excalidraw so it can be tested on its own. */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The box around boxes, or null for none. */
export const boundsOf = (boxes: readonly Box[]): Box | null => {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
};

const center = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** How far from a box's center, along (dx, dy), its edge is: as a fraction of the vector. */
const exit = (box: Box, dx: number, dy: number) => {
  const tx = dx ? box.width / 2 / Math.abs(dx) : Infinity;
  const ty = dy ? box.height / 2 / Math.abs(dy) : Infinity;
  return Math.min(tx, ty, 1);
};

/**
 * A straight arrow from one box to another, starting and ending a few pixels off their edges, as Excalidraw
 * draws one: a start point and the end relative to it.
 */
export const arrowBetween = (from: Box, to: Box, gap = 6): { x: number; y: number; points: [number, number][] } => {
  const a = center(from);
  const b = center(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const pad = gap / length;
  const start = Math.min(exit(from, dx, dy) + pad, 0.5);
  const end = Math.max(1 - exit(to, dx, dy) - pad, 0.5);
  const x = a.x + dx * start;
  const y = a.y + dy * start;
  return { x, y, points: [[0, 0], [dx * end - dx * start, dy * end - dy * start]] };
};

export const NODE = { width: 180, height: 64 };
const SPACE = { x: 120, y: 40 };

/**
 * Places new ideas that came without a position: beside the idea they link to, stacked down its right side, or
 * else in a column to the right of everything on the board. Each takes the room its own size needs, so a tall
 * idea pushes the next one down. Ideas beside the same element share a stack, named by `key` (the element's id)
 * or else by where that element is.
 */
export const placeNodes = (
  wanted: readonly { id: string; near: Box | null; key?: string; size?: { width: number; height: number } }[],
  board: Box | null,
): Map<string, { x: number; y: number }> => {
  const placed = new Map<string, { x: number; y: number }>();
  /* How far down each stack, and the column, has filled. */
  const stacks = new Map<string, number>();
  let column = 0;
  for (const { id, near, key, size } of wanted) {
    const height = size?.height ?? NODE.height;
    if (near) {
      const stack = key ?? `${near.x},${near.y},${near.width},${near.height}`;
      const down = stacks.get(stack) ?? 0;
      stacks.set(stack, down + height + SPACE.y);
      placed.set(id, { x: near.x + near.width + SPACE.x, y: near.y + down });
    } else {
      const x = board ? board.x + board.width + SPACE.x : 0;
      placed.set(id, { x, y: (board ? board.y : 0) + column });
      column += height + SPACE.y;
    }
  }
  return placed;
};

/* How Excalidraw 0.18.1 fits a label inside its shape (element/textElement.ts: BOUND_TEXT_PADDING,
   getBoundTextMaxWidth, computeContainerDimensionForBoundText, getContainerCoords). None of these is exported at
   runtime, so they are repeated here. */
const TEXT_PADDING = 5;
const ARROW_LABEL_WIDTH_FRACTION = 0.7;
const ARROW_LABEL_MIN_WIDTH_PER_FONT_SIZE = 11;

export type TextAlign = "left" | "center" | "right";

/** The widest a label may be inside a container of this type and width. */
export const boundTextMaxWidth = (type: string, width: number, fontSize: number): number => {
  if (type === "arrow") return Math.max(ARROW_LABEL_WIDTH_FRACTION * width, fontSize * ARROW_LABEL_MIN_WIDTH_PER_FONT_SIZE);
  if (type === "ellipse") return Math.round((width / 2) * Math.sqrt(2)) - TEXT_PADDING * 2;
  if (type === "diamond") return Math.round(width / 2) - TEXT_PADDING * 2;
  return width - TEXT_PADDING * 2;
};

/** How wide a shape of this type must be to hold a label this wide. */
export const containerWidthFor = (type: string, textWidth: number): number => {
  const width = Math.ceil(textWidth);
  const padding = TEXT_PADDING * 2;
  if (type === "ellipse") return Math.round(((width + padding) / Math.sqrt(2)) * 2);
  if (type === "diamond") return 2 * (width + padding);
  /* Excalidraw gives an arrow's label its width plus padding on all four sides' worth. */
  if (type === "arrow") return width + padding * 4;
  return width + padding;
};

/** Where a shape's label area starts, from its left edge. */
const textInsetX = (type: string, width: number) =>
  TEXT_PADDING + (type === "ellipse" ? (width / 2) * (1 - Math.sqrt(2) / 2) : type === "diamond" ? width / 4 : 0);

/** The x of a label this wide inside a shape, aligned as the label is. */
export const boundTextX = (shape: { type: string; x: number; width: number }, textWidth: number, fontSize: number, align: TextAlign): number => {
  const left = shape.x + textInsetX(shape.type, shape.width);
  const room = boundTextMaxWidth(shape.type, shape.width, fontSize);
  return align === "left" ? left : align === "right" ? left + room - textWidth : left + (room - textWidth) / 2;
};

/** The x that keeps a line of text anchored where it was, by its alignment, as its width changes. */
export const anchoredX = (x: number, width: number, nextWidth: number, align: TextAlign): number =>
  align === "left" ? x : align === "right" ? x + width - nextWidth : x + (width - nextWidth) / 2;

const graphemes = (word: string): string[] => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(word)].map((part) => part.segment);

/**
 * Text broken into lines no wider than `maxWidth`, at spaces, keeping the lines it already has. A word wider than a
 * whole line is broken between its characters.
 */
export const wrapWords = (text: string, maxWidth: number, measure: (line: string) => number): string =>
  text
    .split("\n")
    .map((paragraph) => {
      const lines: string[] = [];
      let line = "";
      const add = (word: string) => {
        const tried = line ? `${line} ${word}` : word;
        if (measure(tried) <= maxWidth || (!line && graphemes(word).length < 2)) {
          line = tried;
          return;
        }
        if (line) lines.push(line);
        line = "";
        if (measure(word) <= maxWidth) {
          line = word;
          return;
        }
        for (const part of graphemes(word)) {
          if (line && measure(line + part) > maxWidth) {
            lines.push(line);
            line = "";
          }
          line += part;
        }
      };
      for (const word of paragraph.split(" ")) add(word);
      lines.push(line);
      return lines.join("\n");
    })
    .join("\n");

interface MeasuredText {
  id: string;
  isDeleted: boolean;
  x: number;
  width: number;
  fontSize: number;
  textAlign: string;
  containerId: string | null;
  /** How wide its widest line draws in the loaded font. */
  measured: number;
}

interface Container {
  id: string;
  isDeleted: boolean;
  type: string;
  x: number;
  width: number;
}

/**
 * The x and width changes that fit text drawn too narrow: the text widens, keeping its alignment; a shape it is
 * the label of widens around its center if the label no longer fits, as Excalidraw sizes that shape; an arrow it
 * labels keeps its geometry, and the label stays centered on it.
 */
export const textRepairs = (
  texts: readonly MeasuredText[],
  containers: ReadonlyMap<string, Container>,
): Map<string, { x: number; width: number }> => {
  const repairs = new Map<string, { x: number; width: number }>();
  for (const text of texts) {
    if (text.isDeleted || text.measured <= text.width + 0.5) continue;
    const width = text.measured;
    const align = (["left", "center", "right"].includes(text.textAlign) ? text.textAlign : "center") as TextAlign;
    const container = text.containerId ? containers.get(text.containerId) : undefined;
    if (!container || container.isDeleted) {
      repairs.set(text.id, { x: anchoredX(text.x, text.width, width, align), width });
    } else if (container.type === "arrow") {
      repairs.set(text.id, { x: anchoredX(text.x, text.width, width, "center"), width });
    } else {
      const shape = { ...container, ...repairs.get(container.id) };
      if (width > boundTextMaxWidth(shape.type, shape.width, text.fontSize)) {
        const room = Math.max(shape.width, containerWidthFor(shape.type, width));
        shape.x -= (room - shape.width) / 2;
        shape.width = room;
        repairs.set(shape.id, { x: shape.x, width: shape.width });
      }
      repairs.set(text.id, { x: boundTextX(shape, width, text.fontSize, align), width });
    }
  }
  return repairs;
};

interface BoundArrow {
  id: string;
  isDeleted: boolean;
  x: number;
  points: readonly (readonly [number, number])[];
  startBinding: { elementId: string } | null;
  endBinding: { elementId: string } | null;
}

/**
 * Arrows bound to shapes that `textRepairs` widened, moved to stay on them: each bound end keeps its place across the
 * shape, scaled from the shape's center, as the shape's edge moves out. Arrows bound to nothing that moved are left out.
 */
export const followWidened = (
  arrows: readonly BoundArrow[],
  shapes: ReadonlyMap<string, { x: number; width: number }>,
  repairs: ReadonlyMap<string, { x: number; width: number }>,
): Map<string, { x: number; points: [number, number][]; width: number }> => {
  const moved = new Map<string, { x: number; points: [number, number][]; width: number }>();
  const shift = (id: string | undefined, at: number) => {
    const before = id ? shapes.get(id) : undefined;
    const after = id ? repairs.get(id) : undefined;
    if (!before || !after || !before.width) return 0;
    const center = before.x + before.width / 2;
    return center + ((at - center) * after.width) / before.width - at;
  };
  for (const arrow of arrows) {
    if (arrow.isDeleted || arrow.points.length < 2) continue;
    const last = arrow.points.length - 1;
    const start = shift(arrow.startBinding?.elementId, arrow.x + arrow.points[0][0]);
    const end = shift(arrow.endBinding?.elementId, arrow.x + arrow.points[last][0]);
    if (!start && !end) continue;
    /* The first point stays at the arrow's origin, so a moved start moves the arrow and the rest of it back. */
    const points = arrow.points.map(([px, py], i): [number, number] => [i === 0 ? 0 : px - start + (i === last ? end : 0), py]);
    const xs = points.map(([px]) => px);
    moved.set(arrow.id, { x: arrow.x + start, points, width: Math.max(...xs) - Math.min(...xs) });
  }
  return moved;
};

/** How far to move a drawing so it sits to the right of what is on the board, tops aligned. */
export const besideOffset = (board: Box | null, drawing: Box | null, gap = 160): { dx: number; dy: number } => {
  if (!drawing) return { dx: 0, dy: 0 };
  if (!board) return { dx: -drawing.x, dy: -drawing.y };
  return { dx: board.x + board.width + gap - drawing.x, dy: board.y - drawing.y };
};
