import type { Mermaid } from "mermaid";
import { diagramFences } from "@/lib/shared/diagrams";
import type { BookId, ChatMessage } from "@/lib/shared/types";

let loading: Promise<Mermaid> | null = null;

/** Mermaid, loaded the first time a diagram needs it. It is large, so a reply with no diagram never pays for it. */
const load = () => (loading ??= import("mermaid").then(({ default: mermaid }) => mermaid));

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();

/* Drawn at its own size: shrunk to fit the narrow chat, a wide diagram's labels become unreadable, so it scrolls instead. */
const natural = { useMaxWidth: false };

/* Set again before each render, so a diagram drawn after the theme changes takes the new colours. Strict mode
   escapes labels and turns off click handlers and scripts. */
const configure = (mermaid: Mermaid) =>
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    flowchart: natural,
    sequence: natural,
    state: natural,
    mindmap: natural,
    timeline: natural,
    themeVariables: {
      darkMode: document.documentElement.dataset.theme !== "light",
      background: token("panel"),
      primaryColor: token("panel-raised"),
      primaryTextColor: token("paper"),
      primaryBorderColor: token("line-strong"),
      secondaryColor: token("panel-hover"),
      tertiaryColor: token("panel"),
      lineColor: token("dim"),
      textColor: token("paper"),
      edgeLabelBackground: token("panel"),
      fontSize: "13px",
    },
  });

/** Why the source doesn't parse, or null when it does. */
export const diagramError = async (source: string): Promise<string | null> => {
  const mermaid = await load();
  configure(mermaid);
  try {
    await mermaid.parse(source);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

/** The diagram as SVG markup. Throws when it doesn't parse. */
export const renderDiagram = async (id: string, source: string): Promise<string> => {
  const mermaid = await load();
  configure(mermaid);
  /* Parsed first: rendering a bad diagram leaves Mermaid's error graphic in the page. */
  await mermaid.parse(source);
  const { svg } = await mermaid.render(id, source);
  return svg;
};

/**
 * Checks a finished answer's diagrams and sends the ones that don't parse back to the tutor once. Resolves to the
 * answer's new text, or null when nothing changed. Answers stopped early and answers already repaired are left alone.
 */
export const repairDiagrams = async (bookId: BookId, threadId: string, answer: ChatMessage): Promise<string | null> => {
  if (answer.role !== "assistant" || answer.partial || answer.diagramsRepaired) return null;
  const fences = diagramFences(answer.content);
  if (!fences.length) return null;
  const errors = await Promise.all(fences.map((fence) => diagramError(fence.source)));
  const broken = errors.flatMap((error, index) => (error ? [{ index, error }] : []));
  if (!broken.length) return null;
  try {
    const response = await fetch(`/api/books/${bookId}/diagrams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, createdAt: answer.createdAt, broken }),
    });
    const body = (await response.json().catch(() => null)) as { content?: string } | null;
    return response.ok && body?.content && body.content !== answer.content ? body.content : null;
  } catch {
    return null;
  }
};
