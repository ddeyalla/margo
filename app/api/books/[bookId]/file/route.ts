import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { findBook } from "@/lib/server/library";

const CONTENT_TYPES = { epub: "application/epub+zip", pdf: "application/pdf" } as const;

type ByteRange = { start: number; end: number };

/** One "bytes=a-b", "bytes=a-" or "bytes=-n" range. Multipart ranges are not served. */
const parseRange = (header: string, size: number): ByteRange | "invalid" | null => {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, from, to] = match;
  if (!from && !to) return "invalid";
  const start = from ? Number(from) : Math.max(0, size - Number(to));
  const end = from && to ? Math.min(Number(to), size - 1) : size - 1;
  if (start > end || start >= size) return "invalid";
  return { start, end };
};

export async function GET(request: NextRequest, ctx: RouteContext<"/api/books/[bookId]/file">) {
  const { bookId } = await ctx.params;
  const found = await findBook(bookId);
  if (!found) return Response.json({ error: "Book not found." }, { status: 404 });

  const { book, absPath } = found;
  const size = book.sizeBytes;
  const headers = new Headers({
    "Content-Type": CONTENT_TYPES[book.format],
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache",
    "Last-Modified": new Date(book.modifiedAt).toUTCString(),
  });

  const rangeHeader = request.headers.get("range");
  const range = rangeHeader ? parseRange(rangeHeader, size) : null;
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  // Next strips Content-Length from route handler responses and sends the
  // body chunked, so only Content-Range tells the client the size.
  const { start, end } = range ?? { start: 0, end: size - 1 };
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  const body = Readable.toWeb(createReadStream(absPath, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, { status: range ? 206 : 200, headers });
}
