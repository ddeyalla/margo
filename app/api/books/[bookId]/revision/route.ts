import { connection } from "next/server";
import { findBook } from "@/lib/server/library";
import { bookRevision } from "@/lib/server/revision";

/** A cheap stamp of the book's saved state and the settings. A window compares it before and after it was in the background. */
export async function GET(_request: Request, ctx: RouteContext<"/api/books/[bookId]/revision">) {
  await connection();
  const found = await findBook((await ctx.params).bookId);
  if (!found) return Response.json({ error: "Book not found." }, { status: 404 });
  return Response.json({ revision: await bookRevision(found.book.id) }, { headers: { "Cache-Control": "no-store" } });
}
