import { readBookState, saveBookPosition, updateBookState } from "@/lib/server/store";
import { isObject, parsePosition, shortText } from "@/lib/server/validate";
import { readObject, withBook } from "@/lib/server/with-book";
import { tidyTitle, type BookMeta, type Position } from "@/lib/shared/types";

export const GET = withBook(async ({ book }) => Response.json(await readBookState(book.id)));

/** Saves the reading position, the open tutor thread and, on first open, the book's real title and author. */
export const PATCH = withBook(async ({ book, request }) => {
  const body = await readObject(request);
  if (!body) return Response.json({ error: "Expected a JSON object." }, { status: 400 });

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
      title: tidyTitle(shortText(body.meta.title, 500) ?? book.fileTitle),
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

  /* Moving through the book is what "last read" means; a title or open-thread write is not. The position has its own small file, so a scroll stop leaves the threads alone. */
  if (position) await saveBookPosition(book.id, position);
  if (meta || activeThreadId !== undefined) {
    await updateBookState(book.id, (state) => ({
      ...state,
      meta: meta ?? state.meta,
      /* Only a thread the book has; anything else falls back to the list. */
      activeThreadId:
        activeThreadId === undefined ? state.activeThreadId : state.threads.some((t) => t.id === activeThreadId) ? activeThreadId : null,
    }));
  }
  return new Response(null, { status: 204 });
});
