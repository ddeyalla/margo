import type { BookFormat } from "@/lib/shared/types";

/** What went wrong opening a book, in the reader's words, with the library's own message as detail. */
export interface OpenFailure {
  message: string;
  detail: string | null;
}

/** pdf.js names its errors; foliate only has distinct classes. */
const kindOf = (error: unknown): string => (error instanceof Error ? (error.name !== "Error" ? error.name : error.constructor.name) : "");

export const openFailure = (format: BookFormat, error: unknown): OpenFailure => {
  const kind = kindOf(error);
  const detail = error instanceof Error && error.message ? error.message : null;
  const message =
    kind === "PasswordException"
      ? "This PDF is locked with a password. Margo can't open locked PDFs yet."
      : kind === "ResponseException" || kind === "ResponseError" || kind === "NotFoundError"
        ? "The file could not be loaded. It may have been moved or deleted since the library was read. Go back to the library to refresh it."
        : kind === "InvalidPDFException"
          ? "This file doesn't look like a working PDF. It may be damaged or only partly downloaded."
          : format === "epub"
            ? "This EPUB could not be read. It may be damaged, or locked with DRM."
            : "This PDF could not be read. It may be damaged.";
  return { message, detail };
};
