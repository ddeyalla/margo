import type { Anchor, BookFormat, BookId } from "@/lib/shared/types";

/** The search parameter that carries a place to jump to once a book opens. */
const AT = "at";

/** A link that opens a book at an anchor. */
export const bookHref = (id: BookId, anchor: Anchor) => `/book/${id}?${AT}=${encodeURIComponent(JSON.stringify(anchor))}`;

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

const parse = (raw: string, format: BookFormat): Anchor | null => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const anchor = value as Partial<Record<string, unknown>> | null;
  if (!anchor || anchor.kind !== format) return null;
  if (anchor.kind === "epub") return typeof anchor.cfi === "string" && anchor.cfi.startsWith("epubcfi(") ? { kind: "epub", cfi: anchor.cfi } : null;
  return isCount(anchor.page) && anchor.page >= 1 && isCount(anchor.start) && isCount(anchor.end) && anchor.start <= anchor.end
    ? { kind: "pdf", page: anchor.page, start: anchor.start, end: anchor.end }
    : null;
};

/**
 * The place this page was opened at by a search result in another book, read once: the parameter comes off
 * the address, so a reload opens the book at the reader's own place again.
 */
export const takeArrival = (format: BookFormat): Anchor | null => {
  const url = new URL(window.location.href);
  const raw = url.searchParams.get(AT);
  if (raw === null) return null;
  url.searchParams.delete(AT);
  window.history.replaceState(window.history.state, "", url);
  return parse(raw, format);
};
