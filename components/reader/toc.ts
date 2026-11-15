import type { TocEntry } from "./types";

/** An item of foliate's `book.toc`, from the nav document or, failing that, the NCX. */
export interface FoliateTocItem {
  label?: string | null;
  href?: string | null;
  subitems?: FoliateTocItem[] | null;
}

/**
 * The sections that hold one whole chapter and nothing else, so the pages left
 * in the section are the pages left in its chapter. A section qualifies when
 * its first table of contents entry is the only one at that depth or shallower,
 * and the next section in reading order opens with an entry at least as
 * shallow, so the chapter doesn't run on into it. Entries come in reading
 * order, each with the index of the section it points into.
 */
export const wholeChapterSections = (entries: readonly { depth: number; section: number }[], linear: readonly boolean[]): Set<number> => {
  const depths = new Map<number, number[]>();
  for (const { depth, section } of entries) {
    const list = depths.get(section);
    if (list) list.push(depth);
    else depths.set(section, [depth]);
  }
  const whole = new Set<number>();
  for (const [section, [first, ...rest]] of depths) {
    if (rest.some((depth) => depth <= first)) continue;
    const next = linear.findIndex((isLinear, index) => isLinear && index > section);
    const nextFirst = depths.get(next)?.[0];
    if (next === -1 || (nextFirst !== undefined && nextFirst <= first)) whole.add(section);
  }
  return whole;
};

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
