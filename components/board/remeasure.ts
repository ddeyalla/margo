import { CaptureUpdateAction, FONT_FAMILY, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawTextElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { textRepairs } from "./geometry";

const FAMILY_NAMES = new Map<number, string>(Object.entries(FONT_FAMILY).map(([name, id]) => [id as number, name]));

const isText = (element: ExcalidrawElement): element is ExcalidrawTextElement => element.type === "text";

const familiesIn = (elements: readonly ExcalidrawElement[]) =>
  new Set(elements.flatMap((element) => (isText(element) && !element.isDeleted && FAMILY_NAMES.has(element.fontFamily) ? [FAMILY_NAMES.get(element.fontFamily)!] : [])));

/**
 * Measures the board's text again once Excalidraw's fonts have loaded, and saves the board if anything was drawn too
 * narrow. A diagram turned into a board in the chat is measured before Excalidraw is on the page, in a fallback font:
 * drawn in the wider hand font, its labels came out clipped at both ends. Excalidraw keeps the widths it measured
 * while its font loaded, so this measures each line itself. A label wider than its shape widens the shape around it,
 * as Excalidraw would size that shape; an arrow keeps its geometry and its label stays centered on it.
 */
export async function remeasureText(board: ExcalidrawImperativeAPI): Promise<void> {
  /* Every family in the scene loaded, including one a text added during the wait brought with it. */
  const loaded = new Set<string>();
  try {
    for (let round = 0; round < 4; round++) {
      const missing = [...familiesIn(board.getSceneElementsIncludingDeleted())].filter((name) => !loaded.has(name));
      if (!missing.length) break;
      await Promise.all(missing.map((name) => document.fonts.load(`20px "${name}"`)));
      for (const name of missing) loaded.add(name);
    }
  } catch {
    return;
  }
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return;

  /* The scene as it is now, not as it was before the wait: the reader may have drawn, and suggestions may have
     arrived, while the fonts loaded. Nothing below waits, so nothing can change between this read and the update. */
  const elements = board.getSceneElementsIncludingDeleted();
  const texts = elements.flatMap((text) => {
    const family = isText(text) && !text.isDeleted ? FAMILY_NAMES.get(text.fontFamily) : undefined;
    if (!isText(text) || !family || !document.fonts.check(`${text.fontSize}px "${family}"`)) return [];
    context.font = `${text.fontSize}px "${family}"`;
    const measured = Math.max(...text.text.split("\n").map((line) => context.measureText(line).width));
    return [{ ...text, measured }];
  });
  const repairs = textRepairs(texts, new Map(elements.map((element) => [element.id, element])));
  if (!repairs.size) return;
  /* Kept out of undo: it repairs how the board was stored, not something the reader did. The change still saves. */
  board.updateScene({
    elements: elements.map((element) => {
      const repair = repairs.get(element.id);
      return repair ? newElementWith(element, repair) : element;
    }),
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}
