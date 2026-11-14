/** About how fast an adult reads prose, in words a minute. */
export const WORDS_PER_MINUTE = 230;

export const countWords = (text: string): number => text.match(/\S+/g)?.length ?? 0;

/**
 * Minutes to finish a stretch of `words` with `fractionLeft` of it still ahead, rounded up so that anything
 * left is at least one minute. Null when either is not a usable number.
 */
export const minutesLeft = (words: number, fractionLeft: number, wordsPerMinute = WORDS_PER_MINUTE): number | null => {
  if (!Number.isFinite(words) || !Number.isFinite(fractionLeft) || words <= 0) return null;
  const left = words * Math.min(1, Math.max(0, fractionLeft));
  return left <= 0 ? 0 : Math.max(1, Math.ceil(left / wordsPerMinute));
};

export const minutesLeftLabel = (minutes: number): string =>
  minutes === 0 ? "End of chapter" : minutes === 1 ? "About 1 min left in chapter" : `About ${minutes} min left in chapter`;
