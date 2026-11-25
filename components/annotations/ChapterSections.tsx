import type { ReactNode } from "react";
import { byChapter, UNTITLED_SECTION, type Placed } from "@/lib/shared/annotations";

/**
 * A book's highlights, notes or cards as chapter sections in reading order, each under a title that
 * stays pinned while its items scroll past. `children` renders one item as its own keyed `<li>`.
 */
export function ChapterSections<T extends Placed>({
  items,
  within,
  count,
  listClassName,
  children,
}: {
  items: T[];
  /** Order inside each chapter; reading order when omitted. */
  within?: (a: T, b: T) => number;
  /** Words for a "3 notes in this book" line above the sections; no line when omitted. */
  count?: { one: string; many: string };
  listClassName: string;
  children(item: T): ReactNode;
}) {
  return (
    <>
      {count ? (
        <p className="px-2 pb-1 pt-1 text-caption text-dim tabular-nums">
          {items.length} {items.length === 1 ? count.one : count.many} in this book
        </p>
      ) : null}
      {byChapter(items, within).map((group, index) => (
        <section key={`${index}-${group.title}`} aria-label={group.title ?? UNTITLED_SECTION} className="pt-2">
          <h3 className="sticky top-0 z-10 truncate bg-ink px-2 py-1.5 text-label font-medium text-fog">{group.title ?? UNTITLED_SECTION}</h3>
          <ul className={listClassName}>{group.items.map((item) => children(item))}</ul>
        </section>
      ))}
    </>
  );
}
