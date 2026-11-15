import { connection } from "next/server";
import { bookRevision } from "@/lib/server/revision";
import { withBook } from "@/lib/server/with-book";

const revision = withBook(async ({ book }) =>
  Response.json({ revision: await bookRevision(book.id) }, { headers: { "Cache-Control": "no-store" } }),
);

/** A cheap stamp of the book's saved state and the settings. A window compares it before and after it was in the background. */
export async function GET(request: Request, ctx: RouteContext<"/api/books/[bookId]/revision">) {
  /* Before the lookup, so no part of this answer is ever prerendered or reused. */
  await connection();
  return revision(request, ctx);
}
