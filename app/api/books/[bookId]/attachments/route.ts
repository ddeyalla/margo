import { saveAttachment, TOO_LARGE } from "@/lib/server/attachments";
import { readCapped } from "@/lib/server/body";
import { withBook } from "@/lib/server/with-book";
import { MAX_IMAGE_BYTES } from "@/lib/shared/attachments";

/** Keeps one image the reader attached to a message. The body is the raw image; its type is read from its bytes. */
export const POST = withBook(async ({ book, request }) => {
  const bytes = await readCapped(request, MAX_IMAGE_BYTES);
  if (!bytes) return Response.json({ error: TOO_LARGE }, { status: 413 });
  const saved = await saveAttachment(book.id, bytes);
  if (typeof saved === "string") return Response.json({ error: saved }, { status: 415 });
  return Response.json(saved, { status: 201 });
});
