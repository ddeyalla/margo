/* Obsidian-style links between notes: [[Note]], [[Note|shown text]], [[Note#Heading]], [[Note#^block-id]], and
   embeds that start with "!". Shared by the server (backlinks, embeds) and the editor (opening a link). */

export interface WikiLink {
  /** Where the whole link starts and ends in the text, "!" included. */
  from: number;
  to: number;
  embed: boolean;
  /** The note or file named, without any #heading or #^block. */
  target: string;
  /** What follows "#": a heading, or "^id" for a block. */
  subpath: string | null;
  alias: string | null;
}

/** Fenced and inline code, blanked to spaces of the same length so positions still line up. */
export const withoutCode = (text: string): string =>
  text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?(?:^\1[^\n]*$|(?![\s\S]))|`[^`\n]*`/gm, (code) => code.replace(/[^\n]/g, " "));

const LINK = /(!?)\[\[([^\]\n|#]*)(?:#([^\]\n|]*))?(?:\|([^\]\n]*))?\]\]/g;

/** Every link and embed in a note, in order, skipping code. */
export const parseWikiLinks = (text: string): WikiLink[] =>
  [...withoutCode(text).matchAll(LINK)].flatMap((match) => {
    const target = match[2].trim();
    const subpath = match[3]?.trim() || null;
    if (!target && !subpath) return [];
    return [{ from: match.index, to: match.index + match[0].length, embed: match[1] === "!", target, subpath, alias: match[4]?.trim() || null }];
  });

const MD = /\.md$/i;

/** A path's file name without ".md". */
export const noteTitle = (notePath: string): string => (notePath.split("/").pop() ?? notePath).replace(MD, "");

const dirOf = (notePath: string) => notePath.split("/").slice(0, -1).join("/");

/**
 * The file a link names, among `paths` (relative to the notes folder, "/"-separated), as Obsidian resolves it:
 * a target with a folder is a path from the folder's root, otherwise a file name. A name without an extension
 * is a note. When several files share the name, the one in the linking note's folder wins, then the shortest
 * path. Null when nothing matches. An empty target is the linking note itself.
 */
export const resolveWikiLink = (target: string, fromPath: string, paths: readonly string[]): string | null => {
  if (!target) return fromPath;
  const wanted = (/\.[a-z0-9]+$/i.test(target) && !MD.test(target) ? target : `${target.replace(MD, "")}.md`).normalize("NFC").toLowerCase();
  const byPath = (p: string) => p.normalize("NFC").toLowerCase();
  if (wanted.includes("/")) {
    const clean = wanted.replace(/^\/+/, "");
    return paths.find((p) => byPath(p) === clean) ?? paths.find((p) => byPath(p).endsWith(`/${clean}`)) ?? null;
  }
  const named = paths.filter((p) => (byPath(p).split("/").pop() ?? "") === wanted);
  if (!named.length) return null;
  const here = dirOf(fromPath);
  return named.find((p) => dirOf(p) === here) ?? [...named].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
};

/** How a link to `notePath` is written from anywhere: its title, or its path when another file has the same title. */
export const linkTarget = (notePath: string, paths: readonly string[]): string => {
  const title = noteTitle(notePath);
  const clash = paths.some((p) => p !== notePath && noteTitle(p).toLowerCase() === title.toLowerCase());
  return clash ? notePath.replace(MD, "") : title;
};

/**
 * The block a "^id" names: the paragraph, quote or list item whose last line ends in " ^id", without the id.
 * A quote's ">" marks are dropped. Null when the text has no such block.
 */
export const findBlock = (text: string, id: string): string | null => {
  const lines = text.split(/\r?\n/);
  const marker = new RegExp(`\\s\\^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
  const end = lines.findIndex((line) => marker.test(line));
  if (end === -1) return null;
  let start = end;
  const quote = /^\s*>/.test(lines[end]);
  const item = /^\s*([-*+]|\d+[.)])\s/;
  if (!item.test(lines[end])) {
    while (start > 0 && lines[start - 1].trim() && (/^\s*>/.test(lines[start - 1]) === quote) && !item.test(lines[start - 1]) && !/^(#|---)/.test(lines[start - 1])) start--;
  }
  const block = lines.slice(start, end + 1);
  block[block.length - 1] = block[block.length - 1].replace(marker, "");
  return block
    .map((line) => (quote ? line.replace(/^\s*>\s?/, "") : line))
    .join("\n")
    .trim();
};
