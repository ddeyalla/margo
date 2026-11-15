import type { BookFormat, BookId, MissingBook } from "./types";

/** A book in the books folder with nothing saved under its own id, so it can take a missing book's place. */
export interface RelinkCandidate {
  id: BookId;
  title: string;
  relPath: string;
  format: BookFormat;
  sizeBytes: number;
}

/* Lowercase letters and digits only, so "My_Book (2).pdf" and "my book 2.epub" read alike. */
const normalized = (relPath: string) =>
  (relPath.split("/").pop() ?? relPath)
    .replace(/\.[^.]+$/, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const bigrams = (text: string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i += 1) {
    const pair = text.slice(i, i + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
};

/** How alike two file names are, from 0 to 1: the Dice coefficient of their letter pairs. */
export const nameSimilarity = (a: string, b: string): number => {
  const left = normalized(a);
  const right = normalized(b);
  if (left === right) return left ? 1 : 0;
  const pairsA = bigrams(left);
  const pairsB = bigrams(right);
  let shared = 0;
  for (const [pair, count] of pairsA) shared += Math.min(count, pairsB.get(pair) ?? 0);
  const total = Math.max(0, left.length - 1) + Math.max(0, right.length - 1);
  return total ? (2 * shared) / total : 0;
};

/**
 * The candidates that could be this missing book's file, likeliest first. Only its format qualifies when that
 * is known, because the server refuses any other. Then the most alike file name, then the same size. What the
 * missing book does not record takes no part.
 */
export const rankCandidates = (missing: Pick<MissingBook, "format" | "relPath" | "sizeBytes">, candidates: readonly RelinkCandidate[]) => {
  const scored = candidates
    .filter((candidate) => missing.format === null || candidate.format === missing.format)
    .map((candidate) => ({
      candidate,
      name: missing.relPath ? nameSimilarity(missing.relPath, candidate.relPath) : 0,
      size: missing.sizeBytes !== null && candidate.sizeBytes === missing.sizeBytes ? 1 : 0,
    }));
  scored.sort((a, b) => b.name - a.name || b.size - a.size || a.candidate.title.localeCompare(b.candidate.title));
  return scored.map(({ candidate }) => candidate);
};
