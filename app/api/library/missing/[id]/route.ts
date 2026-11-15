import { isBookId } from "@/lib/server/library";
import { forget, missingBookResponse } from "@/lib/server/missing-books";

/** Forgets a missing book: moves what the data folder keeps for it to its forgotten folder. Notes in the notes folder stay. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/library/missing/[id]">) {
  const { id } = await ctx.params;
  if (!isBookId(id)) return Response.json({ error: "Not a book id." }, { status: 400 });
  try {
    await forget(id);
  } catch (error) {
    return missingBookResponse(error);
  }
  return new Response(null, { status: 204 });
}
