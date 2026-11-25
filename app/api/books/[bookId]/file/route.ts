import { open } from "node:fs/promises";
import type { NextRequest } from "next/server";
import { withBook } from "@/lib/server/with-book";

const CONTENT_TYPES = { epub: "application/epub+zip", pdf: "application/pdf" } as const;

type ByteRange = { start: number; end: number };

const CHUNK = 256 * 1024;

/**
 * Bytes start..end of the file as a web stream, read only as the client pulls. A client that goes away mid-book
 * (a reload, a closed tab) cancels it and the file is closed. Readable.toWeb instead throws "Controller is already
 * closed" as an uncaught exception there, which can drop other responses in flight, such as the reader's own fetch.
 */
const fileStream = async (path: string, { start, end }: ByteRange): Promise<ReadableStream<Uint8Array>> => {
  const file = await open(path, "r");
  let position = start;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await file.close();
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const length = Math.min(CHUNK, end + 1 - position);
      let read: { bytesRead: number; buffer: Uint8Array | null } = { bytesRead: 0, buffer: null };
      try {
        if (length > 0) read = await file.read(new Uint8Array(length), 0, length, position);
      } catch (error) {
        await close();
        throw error;
      }
      if (closed) return;
      const { bytesRead, buffer } = read;
      if (!bytesRead || !buffer) {
        await close();
        controller.close();
        return;
      }
      position += bytesRead;
      controller.enqueue(bytesRead === length ? buffer : buffer.subarray(0, bytesRead));
    },
    cancel: close,
  });
};

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

export const GET = withBook<NextRequest>(async ({ book, absPath, request }) => {
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
  const body = await fileStream(absPath, { start, end });
  return new Response(body, { status: range ? 206 : 200, headers });
});
