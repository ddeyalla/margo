/*
 * Opening a book is different from this page being rebuilt because another window changed the book. The
 * refresh-on-return hook leaves a mark just before it refreshes; the next page to open consumes it, so
 * it can tell the two apart and stay quiet after a refresh.
 */
const KEY = "rigg-learn.refreshed-at";
/** A mark older than this belongs to a refresh that never reached a page. */
const FRESH_MS = 15_000;

export const markRefresh = () => {
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* Storage is blocked; the page then counts a refresh as an open. */
  }
};

/** Whether this page replaced one that was just refreshed. Clears the mark. */
export const consumeRefreshMark = (): boolean => {
  try {
    const at = Number(sessionStorage.getItem(KEY));
    sessionStorage.removeItem(KEY);
    return Number.isFinite(at) && at > 0 && Date.now() - at < FRESH_MS;
  } catch {
    return false;
  }
};
