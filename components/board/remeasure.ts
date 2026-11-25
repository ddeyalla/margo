import { CaptureUpdateAction, FONT_FAMILY, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawTextElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/* The gap Excalidraw keeps between a label and the edge of its shape. */
const PADDING = 5;

const FAMILY_NAMES = new Map<number, string>(Object.entries(FONT_FAMILY).map(([name, id]) => [id as number, name]));

const isText = (element: ExcalidrawElement): element is ExcalidrawTextElement => element.type === "text";

/**
 * Measures the board's text again once Excalidraw's fonts have loaded, and saves the board if anything was drawn too
 * narrow. A diagram turned into a board in the chat is measured before Excalidraw is on the page, in a fallback font:
 * drawn in the wider hand font, its labels came out clipped at both ends. Excalidraw keeps the widths it measured
 * while its font loaded, so this measures each line itself. A label wider than its shape widens the shape around it.
 */
export async function remeasureText(board: ExcalidrawImperativeAPI): Promise<void> {
  const elements = board.getSceneElementsIncludingDeleted();
  const families = new Set(elements.flatMap((element) => (isText(element) && FAMILY_NAMES.has(element.fontFamily) ? [FAMILY_NAMES.get(element.fontFamily)!] : [])));
  try {
    await Promise.all([...families].map((name) => document.fonts.load(`20px "${name}"`)));
  } catch {
    return;
  }
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return;

  const next = new Map<string, ExcalidrawElement>(elements.map((element) => [element.id, element]));
  let changed = false;
  for (const text of elements) {
    const family = isText(text) && !text.isDeleted ? FAMILY_NAMES.get(text.fontFamily) : undefined;
    if (!isText(text) || !family || !document.fonts.check(`${text.fontSize}px "${family}"`)) continue;
    context.font = `${text.fontSize}px "${family}"`;
    const width = Math.max(...text.text.split("\n").map((line) => context.measureText(line).width));
    if (width <= text.width + 0.5) continue;
    changed = true;
    const shape = text.containerId ? next.get(text.containerId) : undefined;
    if (shape && !shape.isDeleted) {
      const room = Math.max(shape.width, width + PADDING * 2);
      const grown = room === shape.width ? shape : newElementWith(shape, { width: room, x: shape.x - (room - shape.width) / 2 });
      next.set(shape.id, grown);
      next.set(text.id, newElementWith(text, { width, x: grown.x + (grown.width - width) / 2 }));
    } else {
      const shift = text.textAlign === "center" ? (width - text.width) / 2 : text.textAlign === "right" ? width - text.width : 0;
      next.set(text.id, newElementWith(text, { width, x: text.x - shift }));
    }
  }
  if (!changed) return;
  /* Kept out of undo: it repairs how the board was stored, not something the reader did. The change still saves. */
  board.updateScene({ elements: elements.map((element) => next.get(element.id)!), captureUpdate: CaptureUpdateAction.NEVER });
}
