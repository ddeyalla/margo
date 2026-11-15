const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/* A list item after a blank line may belong to the list above it, so it is never where the text splits. */
const LIST_ITEM = /^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

/**
 * How much of a Markdown answer still being written is finished blocks that later text can't change:
 * everything before the last complete line that starts a new block after a blank line, outside a code fence.
 * The streaming bubble parses that part once and re-parses only the rest as tokens arrive.
 */
export function settledLength(text: string): number {
  const lines = text.split("\n");
  let fence: { char: string; length: number } | null = null;
  let afterBlank = false;
  let offset = 0;
  let settled = 0;
  /* The last line may still be growing, so only lines that have ended count. */
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    const opener = FENCE.exec(line);
    if (fence) {
      if (opener && opener[1][0] === fence.char && opener[1].length >= fence.length && line.slice(opener[0].length).trim() === "") fence = null;
      afterBlank = false;
    } else if (line.trim() === "") {
      afterBlank = true;
    } else {
      if (afterBlank && !/^[ \t]/.test(line) && !LIST_ITEM.test(line)) settled = offset;
      if (opener) fence = { char: opener[1][0], length: opener[1].length };
      afterBlank = false;
    }
    offset += line.length + 1;
  }
  return settled;
}
