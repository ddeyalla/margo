import type { Provider, TutorTurn } from "./types";

export const DIAGRAM_SYSTEM = `You fix Mermaid diagrams that failed to parse. Keep what the diagram shows: the same nodes, labels and links, and a first line that is a %% comment naming it. Change only what breaks the syntax, such as unquoted labels with brackets or parentheses, which you wrap in double quotes. Reply with the fixed diagram alone in one \`\`\`mermaid fence, and nothing else.`;

export const repairRequest = (source: string, error: string) =>
  `This Mermaid diagram failed to parse.\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\nThe parser said:\n\n${error}`;

/**
 * The diagram in a repair reply: the inside of its first fence, or the whole reply when it wrote no fence. null when
 * that still holds a fence line, which would cut the answer's later blocks apart once saved into it.
 */
export const repairedSource = (reply: string): string | null => {
  const fenced = /^ {0,3}(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n {0,3}\1[`~]*[ \t]*$/m.exec(reply);
  const source = (fenced ? fenced[2] : reply).trim();
  return source && !/^ {0,3}(`{3,}|~{3,})/m.test(source) ? source : null;
};

/** Asks the tutor, on a session of its own, for a fixed version of a diagram. null when it fails or writes nothing. */
export const repairDiagram = async (
  provider: Provider,
  source: string,
  error: string,
  model: string | null,
  signal: AbortSignal,
): Promise<string | null> => {
  const turn: TutorTurn = { system: DIAGRAM_SYSTEM, messages: [{ role: "user", content: repairRequest(source, error), images: [] }], sessionId: null, model };
  let reply = "";
  try {
    for await (const event of provider.run(turn, signal)) {
      if (event.type === "text") reply += event.delta;
      else if (event.type === "error") return null;
    }
  } catch {
    return null;
  }
  return signal.aborted ? null : repairedSource(reply);
};
