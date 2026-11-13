/**
 * The numbers along an EPUB CFI's start point: "/" steps, "!" (as -1, so a
 * shorter path sorts first) and a final ":" character offset. A range CFI
 * "parent,start,end" starts at parent followed by start.
 */
const startPath = (cfi: string): number[] => {
  const inner = cfi.replace(/^epubcfi\(|\)$/g, "").replace(/\[(?:\^.|[^\]])*\]/g, "");
  const [parent, start = ""] = inner.split(",");
  return [...(parent + start).matchAll(/([/:!])(\d*)/g)].map(([, mark, digits]) => (mark === "!" ? -1 : Number(digits)));
};

/** Orders two CFIs from the same book by where they start. */
export const compareCfi = (a: string, b: string): number => {
  const x = startPath(a);
  const y = startPath(b);
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};
