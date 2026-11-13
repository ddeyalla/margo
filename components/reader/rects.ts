export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const overlapsLine = (line: Box, box: Box) =>
  Math.min(line.top + line.height, box.top + box.height) - Math.max(line.top, box.top) >= Math.min(line.height, box.height) / 2;

/**
 * One box per run of text on a line. A range's client rects overlap where
 * spans touch, and overlapping translucent tints would darken in stripes.
 * Boxes further apart than about half a line's height, such as two columns,
 * stay separate.
 */
export const mergeLineBoxes = (boxes: Iterable<Box>): Box[] => {
  const lines: Box[][] = [];
  for (const box of [...boxes].filter((b) => b.width >= 0.5 && b.height >= 0.5).sort((a, b) => a.top - b.top)) {
    const line = lines.find((l) => overlapsLine(l[0], box));
    if (line) line.push(box);
    else lines.push([box]);
  }
  const merged: Box[] = [];
  for (const line of lines) {
    let run: Box | null = null;
    for (const box of line.sort((a, b) => a.left - b.left)) {
      if (run && box.left - (run.left + run.width) <= Math.max(run.height, box.height) * 0.6) {
        const right = Math.max(run.left + run.width, box.left + box.width);
        const bottom = Math.max(run.top + run.height, box.top + box.height);
        run.top = Math.min(run.top, box.top);
        run.width = right - run.left;
        run.height = bottom - run.top;
      } else {
        /* Read each field: a DOMRect keeps them as getters, so spreading one copies nothing. */
        run = { left: box.left, top: box.top, width: box.width, height: box.height };
        merged.push(run);
      }
    }
  }
  return merged;
};

/** The smallest box around all of them, or null for none. */
export const unionBox = (boxes: Box[]): Box | null => {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const right = Math.max(...boxes.map((b) => b.left + b.width));
  const bottom = Math.max(...boxes.map((b) => b.top + b.height));
  return { left, top, width: right - left, height: bottom - top };
};
