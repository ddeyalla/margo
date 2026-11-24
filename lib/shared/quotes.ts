import type { Anchor, ChatMessage, QuotedPassage } from "./types";

/** The most passages one message may quote. */
export const MAX_QUOTES_PER_MESSAGE = 5;

/** Every passage quoted into a thread, in the order quoted. Citation n is entry n - 1, so numbers never move. */
export const threadQuotes = (messages: readonly ChatMessage[]): QuotedPassage[] => messages.flatMap((message) => message.quotes ?? []);

/** The number the first passage quoted in `messages[index]` carries. */
export const firstQuoteNumber = (messages: readonly ChatMessage[], index: number): number =>
  1 + threadQuotes(messages.slice(0, index)).length;

/** Whether two anchors mark the same passage. */
export const sameAnchor = (a: Anchor, b: Anchor): boolean =>
  a.kind === "epub" ? b.kind === "epub" && a.cfi === b.cfi : b.kind === "pdf" && a.page === b.page && a.start === b.start && a.end === b.end;

/** What the reader's message says when they send quoted passages with no words. */
export const quoteMessage = (count: number) => (count === 1 ? "Explain this passage." : "Explain these passages.");

/* A citation is a Markdown link to "#cite-N". A relative fragment, so react-markdown keeps the href as written. */
const CITE_HREF = /^#cite-(\d{1,3})$/;

/** The passage number a link cites, or null for an ordinary link. */
export const citedNumber = (href: string | null | undefined): number | null => {
  const match = CITE_HREF.exec(href ?? "");
  return match ? Number(match[1]) : null;
};

/* [claim](#cite-N). The claim holds no brackets: the tutor is asked for a few plain words. */
const CITATION = /\[([^\[\]\n]+)\]\(#cite-(\d{1,3})\)/g;

/** Fenced and inline code, which a citation never sits in. Blanked to spaces so offsets stay put. */
const withoutCode = (text: string) =>
  text.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))|`[^`\n]*`/gm, (code) => code.replace(/[^\n]/g, " "));

/** A passage an answer cites, with the words of the answer that rest on it. */
export interface Citation {
  number: number;
  claims: string[];
}

/** The passages an answer cites, in the order first cited, each with its claims. Numbers with no passage are left out. */
export function answerCitations(text: string, quoteCount: number): Citation[] {
  const cited = new Map<number, string[]>();
  for (const [, claim, digits] of withoutCode(text).matchAll(CITATION)) {
    const number = Number(digits);
    if (number < 1 || number > quoteCount) continue;
    const claims = cited.get(number) ?? [];
    const words = claim.trim();
    if (words && !claims.includes(words)) claims.push(words);
    cited.set(number, claims);
  }
  return [...cited].map(([number, claims]) => ({ number, claims }));
}

/** A citation saved as a note on its passage: what the tutor said rests on it. */
export const citationNote = (claims: readonly string[]) =>
  `The tutor, citing this passage:\n\n${claims.map((claim) => `> ${claim.replace(/\s+/g, " ").trim()}`).join("\n>\n")}`;

/* Letters and digits only: hyphens split across lines, soft hyphens, quote marks and spacing differ between how a
   passage was quoted and how its text reads back. */
const letters = (text: string) => text.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Whether the text found at a passage's anchor is still the passage that was quoted. A re-imported or edited book can
 * keep an anchor that parses but now lands somewhere else. A little slack covers text cut a word earlier or later.
 */
export function samePassage(found: string, quoted: string): boolean {
  const a = letters(found);
  const b = letters(quoted);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return long.includes(short) && short.length >= long.length * 0.8;
}
