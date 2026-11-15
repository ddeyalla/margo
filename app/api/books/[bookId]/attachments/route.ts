import { saveAttachment, TOO_LARGE } from "@/lib/server/attachments";
import { readCapped } from "@/lib/server/body";
import { findBook } from "@/lib/server/library";
import { MAX_IMAGE_BYTES } from "@/lib/shared/attachments";

/** Keeps one image the reader attached to a message. The body is the raw image; its type is read from its bytes. */
export async function POST(request: Request, ctx: RouteContext<"/api/books/[bookId]/attachments">) {
  const found = await findBook((await ctx.params).bookId);
  if (!found) return Response.json({ error: "Book not found." }, { status: 404 });
  const bytes = await readCapped(request, MAX_IMAGE_BYTES);
  if (!bytes) return Response.json({ error: TOO_LARGE }, { status: 413 });
  const saved = await saveAttachment(found.book.id, bytes);
  if (typeof saved === "string") return Response.json({ error: saved }, { status: 415 });
  return Response.json(saved, { status: 201 });
}
