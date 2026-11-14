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

/** Saves the reading position, the open tutor thread and, on first open, the book's real title and author. */
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

  let activeThreadId: string | null | undefined;
  if ("activeThreadId" in body) {
    if (body.activeThreadId !== null && typeof body.activeThreadId !== "string") {
      return Response.json({ error: "Invalid activeThreadId." }, { status: 400 });
    }
    activeThreadId = body.activeThreadId;
  }

  await updateBookState(book.id, (state) => ({
    ...state,
    position: position ?? state.position,
    /* Moving through the book is what "last read" means; a title or open-thread write is not. */
    lastReadAt: position ? new Date().toISOString() : state.lastReadAt,
    meta: meta ?? state.meta,
    /* Only a thread the book has; anything else falls back to the list. */
    activeThreadId:
      activeThreadId === undefined ? state.activeThreadId : state.threads.some((t) => t.id === activeThreadId) ? activeThreadId : null,
  }));
  return new Response(null, { status: 204 });
}
