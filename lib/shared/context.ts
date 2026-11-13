/** Characters of book text kept on each side of a selection. */
export const CONTEXT_CHARS = 1500;

/** Words shorter than this are dropped at a cut edge rather than kept as a fragment. */
const WORD_SLACK = 40;

/** Collapses runs of spaces and keeps paragraph breaks as one blank line. */
export const normalizeText = (text: string): string =>
  text
    .replace(/­/g, "")
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** The end of the text before a selection, at most `limit` characters, starting on a whole word. */
export const trimBefore = (text: string, limit = CONTEXT_CHARS): string => {
  const flat = normalizeText(text.slice(-limit * 2));
  if (flat.length <= limit) return flat;
  const cut = flat.slice(flat.length - limit);
  const firstBreak = cut.search(/\s/);
  return (firstBreak > -1 && firstBreak < WORD_SLACK ? cut.slice(firstBreak + 1) : cut).trimStart();
};

/** The start of the text after a selection, at most `limit` characters, ending on a whole word. */
export const trimAfter = (text: string, limit = CONTEXT_CHARS): string => {
  const flat = normalizeText(text.slice(0, limit * 2));
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const lastBreak = cut.search(/\s\S*$/);
  return (lastBreak > limit - WORD_SLACK ? cut.slice(0, lastBreak) : cut).trimEnd();
};
