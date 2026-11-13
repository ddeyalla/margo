import type { PageNumber } from "@/components/reader/types";

const count = (value: number) => value.toLocaleString("en-US");

/** The page as the footer shows it: "p. 34", "Loc 120 of 2,400" or "p. 12 of 340". Locations count from 1 here, like a page. */
export const pageLabel = (page: PageNumber): string => {
  switch (page.kind) {
    case "print":
      return `p. ${page.label}`;
    case "location":
      return `Loc ${count(Math.min(page.total, page.current + 1))} of ${count(page.total)}`;
    case "pdf":
      return `p. ${count(page.page)} of ${count(page.total)}`;
  }
};

export const pagesLeftLabel = (left: number): string =>
  left === 0 ? "Last page in chapter" : `${left} ${left === 1 ? "page" : "pages"} left in chapter`;

export const percentLabel = (fraction: number): string => `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
