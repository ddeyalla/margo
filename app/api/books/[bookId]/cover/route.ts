import { bookCover } from "@/lib/server/covers";
import { withBook } from "@/lib/server/with-book";

/* An image request, so a missing book or cover gets a bare 404 rather than the JSON error. */
const noCover = () => new Response(null, { status: 404 });

/** The cover URL carries the book's modified time, so a changed book gets a new URL and this one can be kept. */
export const GET = withBook(async (found) => {
  const cover = await bookCover(found);
  if (!cover) return noCover();
  return new Response(new Uint8Array(cover), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" },
  });
}, noCover);
