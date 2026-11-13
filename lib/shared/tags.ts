/**
 * The Obsidian-style #tags in a note's markdown, without the "#". Code is
 * skipped, a tag needs at least one non-digit, and spellings that differ only
 * in case count once, keeping the first.
 */
export const parseTags = (body: string): string[] => {
  const prose = body.replace(/```[\s\S]*?(?:```|$)/g, " ").replace(/`[^`\n]*`/g, " ");
  const tags = new Map<string, string>();
  for (const [, raw] of prose.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) {
    const tag = raw.replace(/[/-]+$/, "");
    if (/\D/.test(tag) && !tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag);
  }
  return [...tags.values()];
};
