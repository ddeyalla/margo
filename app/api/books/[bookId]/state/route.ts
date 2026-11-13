import { findBook } from "@/lib/server/library";
import { readBookState, updateBookState } from "@/lib/server/store";
import { isObject, parsePosition, shortText } from "@/lib/server/validate";
import type { BookMeta, Position } from "@/lib/shared/types";

const notFound = () => Response.json({ error: "Book not found." }, { status: 404 });

export async function GET(_request: Request, ctx: RouteContext<"/api/books/[bookId]/state">) {
  const found = await findBook((await ctx.params).bookId);
  if (!found) return notFound();
  return Response.json(await readBookState(found.book.id));
}

/** Saves the reading position and, on first open, the book's real title and author. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/books/[bookId]/state">) {
  const found = await findBook((await ctx.params).bookId);
  if (!found) return notFound();
  const { book } = found;

  const body: unknown = await request.json().catch(() => null);
  if (!isObject(body)) return Response.json({ error: "Expected a JSON object." }, { status: 400 });

  let position: Position | undefined;
  if ("position" in body) {
    const parsed = parsePosition(body.position, book.format);
    if (!parsed) return Response.json({ error: "Invalid position." }, { status: 400 });
    position = parsed;
  }

  let meta: BookMeta | undefined;
  if ("meta" in body) {
    if (!isObject(body.meta)) return Response.json({ error: "Invalid meta." }, { status: 400 });
    meta = {
      title: shortText(body.meta.title, 500) ?? book.fileTitle,
      author: shortText(body.meta.author, 500),
      format: book.format,
      relPath: book.relPath,
    };
  }

  await updateBookState(book.id, (state) => ({
    ...state,
    position: position ?? state.position,
    meta: meta ?? state.meta,
  }));
  return new Response(null, { status: 204 });
}
