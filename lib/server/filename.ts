/**
 * A readable title and author from a downloaded book's file name.
 *
 * Downloaded names come in a few shapes:
 * - "Title (Author One, Author Two) (example.org, mirror.net).epub", with a trailing list of site domains
 * - the dash-separated catalogue form: "Title -- Author -- year -- publisher -- isbn -- hash -- source.pdf"
 * - "Title - Author.epub", or "_Site.com_Title_-_Author.epub" with "_" for every space and a leading site domain
 * They use "_" where the title had a colon, and the "--" form cuts long titles off mid-phrase.
 */
export interface FileTitle {
  title: string;
  author: string | null;
}

/** A host name such as "example.org" or "books.example.net". */
const DOMAIN = String.raw`[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}`;
/** A parenthesised list of one or more domains, "(example.org, mirror.net)", which sites append to a name. */
const MIRROR_LIST = new RegExp(String.raw`\s*\(\s*${DOMAIN}(?:\s*,\s*${DOMAIN})*\s*\)`, "gi");
/** A domain such as "Site.com" at the very start of an underscore-style name; "Node.js" and "Tool.ts" are title words. */
const WATERMARK = new RegExp(String.raw`^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?!(?:js|ts)(?![a-z]))[a-z]{2,}(?![\p{L}\p{N}.-])\s*`, "iu");

/** Lowercase words that mark a phrase as an edition or series tag rather than a person. */
const TAG_WORDS = new Set([
  "a", "an", "the", "of", "for", "in", "on", "with", "to", "by", "from",
  "edition", "ed", "version", "release", "early", "first", "second", "third", "new", "revised", "updated",
  "complete", "illustrated", "annotated", "abridged", "unabridged", "classics", "translated", "translation",
  "scratch", "meap", "vol", "volume", "part", "book", "books", "series", "guide", "handbook", "press", "media",
]);

/** Lowercase name particles, as in "Ludwig van Beethoven". */
const PARTICLES = new Set(["van", "von", "de", "da", "del", "der", "di", "du", "la", "le", "bin", "al"]);

/** "Okafor", "O'Brien", "Saint-Clair", "R.", "J". Not "MEAP" or "LLM": runs of capitals are acronyms. */
const isNameWord = (word: string): boolean => {
  if (PARTICLES.has(word)) return true;
  if (TAG_WORDS.has(word.toLowerCase())) return false;
  if (!/^\p{Lu}[\p{L}\p{M}'’.-]*$/u.test(word)) return false;
  return !/^\p{Lu}{3,}$/u.test(word);
};

const isPersonName = (name: string): boolean => {
  const words = name.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 4 && words.every(isNameWord) && !words.every((w) => PARTICLES.has(w));
};

/** "Lindqvist, Mara" reads as "Mara Lindqvist"; any other list is left as written. */
const firstNameFirst = (names: string): string => {
  const pair = /^([\p{L}\p{M}'’.-]+),\s*([\p{L}\p{M}'’.-]+)$/u.exec(names);
  return pair ? `${pair[2]} ${pair[1]}` : names;
};

/** The names in a phrase, when every comma-, semicolon- or "and"-separated part reads as a person. */
const namesIn = (phrase: string): string | null => {
  const parts = phrase.split(/\s*(?:[,;&]|\band\b)\s*/).filter(Boolean);
  return parts.length && parts.every(isPersonName) ? firstNameFirst(phrase.trim()) : null;
};

/** "Title (Author, Author)" or "Title - Author", split; null when the tail does not read as names. */
const trailingAuthors = (title: string): FileTitle | null => {
  const paren = /^(.*\S)\s*\(([^()]+)\)$/.exec(title);
  const dashed = title.split(" - ");
  const [head, tail] = paren ? [paren[1], paren[2]] : dashed.length === 2 ? dashed : [title, null];
  const author = tail && namesIn(tail);
  return author ? { title: head, author } : null;
};

/** A name's spelling for spotting duplicates: "Ada K. Moreau" and "ada k moreau" match. */
const nameKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\s]/gu, "").replace(/\s+/g, " ").trim();

/** The author part of a catalogue-form name: "Ada K_ Moreau", "Ada Moreau; Tom Reyes" or "Moreau, Ada;Reyes, Tom". */
const archiveAuthors = (segment: string): string | null => {
  const names = new Map<string, string>();
  for (const item of segment.split(";")) {
    const cleaned = item
      .replace(/(\p{Lu})_/gu, "$1.")
      .replace(/_/g, " ")
      .replace(/^\s*edited by\s+/i, "")
      .replace(/[\s,]+$/, "")
      .replace(/\s+/g, " ")
      .trim();
    const parts = cleaned.split(/\s*,\s*/);
    /* "Ada K. Moreau, Ada Moreau" is a list of people; "Moreau, Ada" is one person written last name first. */
    const people = parts.length > 1 && parts.every((part) => part.includes(" ")) ? parts : [firstNameFirst(cleaned)];
    for (const person of people) if (person && !names.has(nameKey(person))) names.set(nameKey(person), person);
  }
  return [...names.values()].join(", ") || null;
};

const tidyTitle = (title: string): string =>
  title
    .replace(/_/g, ":")
    .replace(/\s+:/g, ":")
    .replace(/\s+/g, " ")
    .trim();

/** A title the "--" split cut off mid-phrase ("Methods, Models, and") loses the dangling joiner. */
const dropDanglingJoiner = (title: string): string =>
  title.replace(/(?:[\s,;:&]+|\s(?:and|or|to|of|the|a|an|for|with|in|on))+$/i, "");

export const parseFileName = (fileName: string): FileTitle => {
  let base = fileName.normalize("NFC").replace(/\.(epub|pdf)$/i, "").replace(MIRROR_LIST, "");
  if (!base.includes(" ")) base = base.replace(/_/g, " ").trim().replace(WATERMARK, "");
  const [head, authorSegment] = base.split(/\s+--\s+/);
  let title = tidyTitle(head);
  let author = authorSegment ? archiveAuthors(authorSegment) : null;
  if (authorSegment) {
    title = dropDanglingJoiner(title);
  } else {
    const split = trailingAuthors(title);
    if (split) ({ title, author } = split);
  }
  return { title: title || fileName, author };
};
