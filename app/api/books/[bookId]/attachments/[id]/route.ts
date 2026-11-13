import { readAttachment } from "@/lib/server/attachments";
import { findBook } from "@/lib/server/library";

/** An image by its id. Ids are never reused, so the browser may keep it. */
export async function GET(_request: Request, ctx: RouteContext<"/api/books/[bookId]/attachments/[id]">) {
  const { bookId, id } = await ctx.params;
  const found = await findBook(bookId);
  const image = found ? await readAttachment(found.book.id, id) : null;
  if (!image) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": image.attachment.mediaType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
