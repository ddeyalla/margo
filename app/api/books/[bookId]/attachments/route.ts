import { saveAttachment, TOO_LARGE } from "@/lib/server/attachments";
import { withBook } from "@/lib/server/with-book";
import { MAX_IMAGE_BYTES } from "@/lib/shared/attachments";

/** The body, or null once it runs past `max` bytes. It stops reading there, so an oversized upload is never held in memory. */
const readCapped = async (request: Request, max: number): Promise<Uint8Array | null> => {
  if (Number(request.headers.get("content-length")) > max) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
};

/** Keeps one image the reader attached to a message. The body is the raw image; its type is read from its bytes. */
export const POST = withBook(async ({ book, request }) => {
  const bytes = await readCapped(request, MAX_IMAGE_BYTES);
  if (!bytes) return Response.json({ error: TOO_LARGE }, { status: 413 });
  const saved = await saveAttachment(book.id, bytes);
  if (typeof saved === "string") return Response.json({ error: saved }, { status: 415 });
  return Response.json(saved, { status: 201 });
});
