const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** A Mermaid fence in a Markdown text: where it sits, and the diagram source inside it. */
export interface DiagramFence {
  /** Offset of the opening fence line. */
  start: number;
  /** Offset just past the closing fence line, or the end of the text when the fence never closes. */
  end: number;
  source: string;
}

/** Every closed ```mermaid fence in the text, in order. Fences of other languages are skipped whole. */
export function diagramFences(text: string): DiagramFence[] {
  const fences: DiagramFence[] = [];
  let open: { char: string; length: number; mermaid: boolean; start: number; body: number } | null = null;
  let offset = 0;
  for (const line of text.split("\n")) {
    const next = offset + line.length + 1;
    const match = FENCE.exec(line);
    if (!open) {
      if (match && !(match[1][0] === "`" && match[2].includes("`"))) {
        const info = match[2].trim().split(/\s+/)[0].toLowerCase();
        open = { char: match[1][0], length: match[1].length, mermaid: info === "mermaid", start: offset, body: next };
      }
    } else if (match && match[1][0] === open.char && match[1].length >= open.length && match[2].trim() === "") {
      if (open.mermaid) fences.push({ start: open.start, end: Math.min(next, text.length), source: text.slice(open.body, offset).replace(/\n$/, "") });
      open = null;
    }
    offset = next;
  }
  return fences;
}

/** A Mermaid block as Markdown, as it goes into an answer or a note. */
export const diagramMarkdown = (source: string) => `\`\`\`mermaid\n${source.trim()}\n\`\`\``;

/** The text with its `index`th Mermaid fence holding `source` instead. Unchanged when there is no such fence. */
export function replaceDiagram(text: string, index: number, source: string): string {
  const fence = diagramFences(text)[index];
  if (!fence) return text;
  const after = text.slice(fence.end);
  return `${text.slice(0, fence.start)}${diagramMarkdown(source)}${fence.end <= text.length && text[fence.end - 1] === "\n" ? "\n" : ""}${after}`;
}
