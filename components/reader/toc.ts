import type { TocEntry } from "./types";

/** An item of foliate's `book.toc`, from the nav document or, failing that, the NCX. */
export interface FoliateTocItem {
  label?: string | null;
  href?: string | null;
  subitems?: FoliateTocItem[] | null;
}

/**
 * foliate's nested table of contents as flat entries in reading order, keyed
 * by the foliate item each came from, so the item foliate reports on relocate
 * finds its entry. Items with no label or no link are left out; their children
 * keep their depth.
 */
export const epubToc = (items: FoliateTocItem[] | null | undefined): Map<FoliateTocItem, TocEntry> => {
  const entries = new Map<FoliateTocItem, TocEntry>();
  const visit = (list: FoliateTocItem[] | null | undefined, depth: number) => {
    for (const item of list ?? []) {
      const label = item.label?.replace(/\s+/g, " ").trim();
      if (label && item.href) entries.set(item, { label, depth, target: { kind: "epub", href: item.href } });
      visit(item.subitems, depth + 1);
    }
  };
  visit(items, 0);
  return entries;
};
