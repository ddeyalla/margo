import type { Anchor, BookFormat, Position, QuotedPassage } from "@/lib/shared/types";

/* Hand-written checks for what the browser sends. Each returns the value in
   its exact shape, or null, so nothing unchecked reaches the store. */

type Json = Record<string, unknown>;

/** The longest passage a highlight, card or tutor question may quote. */
export const MAX_QUOTE = 12_000;
/** The longest message the reader may send the tutor. */
export const MAX_MESSAGE = 8_000;

export const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFraction = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

const isCfi = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("epubcfi(") && value.length <= 4000;

/** An image's id: 128 random bits as hex. Images are looked up by nothing else, so an id can't name another file. */
export const isAttachmentId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{32}$/.test(value);

/** Up to `max` distinct image ids, or null for anything else. */
export const parseAttachmentIds = (value: unknown, max: number): string[] | null =>
  Array.isArray(value) && value.length <= max && value.every(isAttachmentId) && new Set(value).size === value.length ? value : null;

/** A string of at most `max` characters, trimmed; null if absent, empty or too long. */
export const shortText = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;

export const parsePosition = (value: unknown, format: BookFormat): Position | null => {
  if (!isObject(value) || value.kind !== format) return null;
  if (value.kind === "epub" && isCfi(value.cfi) && isFraction(value.fraction)) {
    return { kind: "epub", cfi: value.cfi, fraction: value.fraction };
  }
  if (value.kind === "pdf" && isCount(value.page) && value.page >= 1 && isFraction(value.offset) && isFraction(value.fraction)) {
    return { kind: "pdf", page: value.page, offset: value.offset, fraction: value.fraction };
  }
  return null;
};

export const parseAnchor = (value: unknown, format: BookFormat): Anchor | null => {
  if (!isObject(value) || value.kind !== format) return null;
  if (value.kind === "epub" && isCfi(value.cfi)) return { kind: "epub", cfi: value.cfi };
  if (value.kind === "pdf" && isCount(value.page) && value.page >= 1 && isCount(value.start) && isCount(value.end) && value.start <= value.end) {
    return { kind: "pdf", page: value.page, start: value.start, end: value.end };
  }
  return null;
};

/** Up to `max` passages the reader quoted, each with an anchor in this book's format; null for anything else. */
export const parseQuotes = (value: unknown, format: BookFormat, max: number): QuotedPassage[] | null => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) return null;
  const quotes: QuotedPassage[] = [];
  for (const item of value) {
    const anchor = isObject(item) ? parseAnchor(item.anchor, format) : null;
    const text = isObject(item) ? shortText(item.text, MAX_QUOTE) : null;
    if (!isObject(item) || !anchor || !text) return null;
    quotes.push({ anchor, text, chapterTitle: shortText(item.chapterTitle, 500) });
  }
  return quotes;
};
