import { convertToExcalidrawElements, getCommonBounds, newElementWith, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";
import { diagramTitle } from "@/lib/shared/boards";
import { besideOffset, boundsOf, type Box } from "./geometry";

const boxOf = (elements: readonly ExcalidrawElement[]): Box | null => {
  if (!elements.length) return null;
  const [x1, y1, x2, y2] = getCommonBounds(elements);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
};

/**
 * A Mermaid diagram from the chat as editable board elements, placed to the right of what is on the board.
 * Flowcharts come back as shapes, labels and bound arrows; a kind the converter can't take apart comes back as one
 * picture, with its file. Throws with the converter's reason when the diagram can't be read.
 */
export const mermaidElements = async (
  source: string,
  board: readonly ExcalidrawElement[],
): Promise<{ elements: ExcalidrawElement[]; files: BinaryFileData[] }> => {
  const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
  const { elements: skeletons, files } = await parseMermaidToExcalidraw(source, { themeVariables: { fontSize: "16px" } });
  const made = convertToExcalidrawElements(skeletons, { regenerateIds: true });
  const live = board.filter((element) => !element.isDeleted);
  const { dx, dy } = besideOffset(boundsOf(live.length ? [boxOf(live)!] : []), boxOf(made));
  return {
    elements: made.map((element) => newElementWith(element, { x: element.x + dx, y: element.y + dy })),
    files: Object.values(files ?? {}),
  };
};

/** A diagram as a new board's file, and the title it names itself with. */
export const mermaidBoard = async (source: string): Promise<{ title: string; text: string }> => {
  const { elements, files } = await mermaidElements(source, []);
  const byId: BinaryFiles = Object.fromEntries(files.map((file) => [file.id, file]));
  return { title: diagramTitle(source), text: serializeAsJSON(elements, {}, byId, "local") };
};
