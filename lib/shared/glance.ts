/** A hover glance's answer: the term's meaning in its sentence, one example, and whether the sentence teaches it. */
export interface Glance {
  gist: string;
  example: string;
  /** Null until the model has said. */
  core: boolean | null;
}

/**
 * Reads the glance as it streams, in the three lines the model is asked for (lib/server/glance.ts): the meaning,
 * then "Example: ...", then "Kind: core" or "Kind: background". A line still being written is shown as it grows.
 */
export const parseGlance = (text: string): Glance => {
  let gist = "";
  let example = "";
  let core: boolean | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^\d\.\s*/, "");
    if (!line) continue;
    const kind = /^kind:\s*(\w*)/i.exec(line);
    if (kind) core = kind[1].toLowerCase().startsWith("core") ? true : kind[1].toLowerCase().startsWith("back") ? false : null;
    else if (/^example:/i.test(line)) example = line.replace(/^example:\s*/i, "");
    else if (!example) gist = gist ? `${gist} ${line}` : line;
  }
  return { gist, example, core };
};
