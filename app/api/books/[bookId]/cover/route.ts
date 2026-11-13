import { bookCover } from "@/lib/server/covers";
import { findBook } from "@/lib/server/library";

/** The cover URL carries the book's modified time, so a changed book gets a new URL and this one can be kept. */
export async function GET(_request: Request, ctx: RouteContext<"/api/books/[bookId]/cover">) {
  const { bookId } = await ctx.params;
  const found = await findBook(bookId);
  const cover = found ? await bookCover(found) : null;
  if (!cover) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(cover), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
