/**
 * A readable title from a downloaded book's file name. Shadow-library names
 * carry a mirror list in parentheses or a " -- author -- year -- hash" tail,
 * and use "_" where the title had a colon.
 */
export const cleanFileTitle = (fileName: string): string => {
  const title = fileName
    .replace(/\.(epub|pdf)$/i, "")
    .replace(/\s*\((?:z-library|z-lib|1lib)[^)]*\)/gi, "")
    .replace(/\s+--\s.*$/, "")
    .replace(/_/g, ":")
    .replace(/\s+:/g, ":")
    .replace(/\s+/g, " ")
    .trim();
  return title || fileName;
};
