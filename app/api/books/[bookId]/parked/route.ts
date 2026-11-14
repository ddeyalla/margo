import { findBook } from "@/lib/server/library";
import { discardParked, parkThread, saveParked } from "@/lib/server/parked";
import { isObject } from "@/lib/server/validate";

type Context = RouteContext<"/api/books/[bookId]/parked">;

const notFound = () => Response.json({ error: "Book not found." }, { status: 404 });

/** Parks a question on a passage: saved with the book, not sent to the tutor. Answers with the saved thread. */
export async function POST(request: Request, ctx: Context) {
  const found = await findBook((await ctx.params).bookId);
  if (!found) return notFound();
  const body: unknown = await request.json().catch(() => null);
  if (!isObject(body)) return Response.json({ error: "Expected a JSON object." }, { status: 400 });
  const thread = parkThread(body, found.book);
  if (typeof thread === "string") return Response.json({ error: thread }, { status: 400 });
  await saveParked(found.book.id, thread);
  return Response.json({ thread });
}

/** Deletes a parked question by id. Only a question that is still parked can be deleted this way. */
export async function DELETE(request: Request, ctx: Context) {
  const found = await findBook((await ctx.params).bookId);
  if (!found) return notFound();
  const body: unknown = await request.json().catch(() => null);
  if (!isObject(body) || typeof body.id !== "string") return Response.json({ error: "Expected { id }." }, { status: 400 });
  await discardParked(found.book.id, body.id);
  return new Response(null, { status: 204 });
}
