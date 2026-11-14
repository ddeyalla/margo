import type { SelectionRect } from "./types";

/** Space between a floating bar and its passage, and between the bar and the reader's edges. */
const GAP = 8;
const EDGE = 8;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

/**
 * Places a floating bar above a passage (below it when there's no room),
 * kept inside the reader area. Hidden while the passage is out of view, such
 * as scrolled away or on a page turned past.
 */
export const placeFloating = (box: HTMLElement, rect: SelectionRect, area: DOMRect) => {
  const outside =
    rect.top + rect.height < area.top || rect.top > area.bottom || rect.left + rect.width < area.left || rect.left > area.right;
  /* Never wider than the reader; a bar that doesn't fit wraps onto a second row. */
  box.style.maxWidth = `${Math.max(0, area.width - 2 * EDGE)}px`;
  const { offsetWidth: width, offsetHeight: height } = box;
  let top = rect.top - height - GAP;
  if (top < area.top + EDGE) top = rect.top + rect.height + GAP;
  top = clamp(top, area.top + EDGE, area.bottom - height - EDGE);
  const left = clamp(rect.left + rect.width / 2 - width / 2, area.left + EDGE, area.right - width - EDGE);
  box.style.left = `${Math.round(left)}px`;
  box.style.top = `${Math.round(top)}px`;
  box.style.visibility = outside ? "hidden" : "visible";
};
