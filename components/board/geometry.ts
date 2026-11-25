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
 * else in a column to the right of everything on the board.
 */
export const placeNodes = (
  wanted: readonly { id: string; near: Box | null }[],
  board: Box | null,
): Map<string, { x: number; y: number }> => {
  const placed = new Map<string, { x: number; y: number }>();
  const stacks = new Map<Box, number>();
  let column = 0;
  for (const { id, near } of wanted) {
    if (near) {
      const n = stacks.get(near) ?? 0;
      stacks.set(near, n + 1);
      placed.set(id, { x: near.x + near.width + SPACE.x, y: near.y + n * (NODE.height + SPACE.y) });
    } else {
      const x = board ? board.x + board.width + SPACE.x : 0;
      const y = (board ? board.y : 0) + column++ * (NODE.height + SPACE.y);
      placed.set(id, { x, y });
    }
  }
  return placed;
};

/** How far to move a drawing so it sits to the right of what is on the board, tops aligned. */
export const besideOffset = (board: Box | null, drawing: Box | null, gap = 160): { dx: number; dy: number } => {
  if (!drawing) return { dx: 0, dy: 0 };
  if (!board) return { dx: -drawing.x, dy: -drawing.y };
  return { dx: board.x + board.width + gap - drawing.x, dy: board.y - drawing.y };
};
