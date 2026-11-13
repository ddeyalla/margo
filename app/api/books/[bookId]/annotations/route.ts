import { changeAnnotations, parseChange, type AnnotationMethod } from "@/lib/server/annotations";
import { getConfig } from "@/lib/server/config";
import { findBook } from "@/lib/server/library";

type Context = RouteContext<"/api/books/[bookId]/annotations">;

/** Saves one highlight or note change, then answers with every annotation and the markdown copy's status. */
const handle = (method: AnnotationMethod) => async (request: Request, ctx: Context) => {
  const found = await findBook((await ctx.params).bookId);
  if (!found) return Response.json({ error: "Book not found." }, { status: 404 });
  const change = parseChange(method, await request.json().catch(() => null), found.book.format);
  if (typeof change === "string") return Response.json({ error: change }, { status: 400 });
  const { dataDir, notesDir } = getConfig();
  return Response.json(await changeAnnotations(found.book, change, { dataDir, notesDir }));
};

/** Body: `{ highlight }`, or `{ note, highlightId }` where highlightId names the highlight to create if the passage has none. */
export const POST = handle("POST");
/** Body: `{ note: { id, body } }`. */
export const PATCH = handle("PATCH");
/** Body: `{ highlightId }` or `{ noteId }`. */
export const DELETE = handle("DELETE");
