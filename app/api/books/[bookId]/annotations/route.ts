import { changeAnnotations, parseChange } from "@/lib/server/annotations";
import { getConfig } from "@/lib/server/config";
import { findBook } from "@/lib/server/library";
import type { AnnotationMethod } from "@/lib/shared/annotations";

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

/* The body is one AnnotationChange: add-highlight and add-note go as POST, edit-note as PATCH, the removals as DELETE. */
export const POST = handle("POST");
export const PATCH = handle("PATCH");
export const DELETE = handle("DELETE");
