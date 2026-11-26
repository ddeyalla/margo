import { discardParked } from "@/lib/server/parked";
import { ToolError } from "@/lib/server/tools/schema";
import { parkQuestion } from "@/lib/server/tools/write";
import { readObject, withBook } from "@/lib/server/with-book";

/** Parks a question on a passage: saved with the book, not sent to the tutor. Answers with the saved thread. */
export const POST = withBook(async ({ book, request }) => {
  const body = await readObject(request);
  if (!body) return Response.json({ error: "Expected a JSON object." }, { status: 400 });
  try {
    return Response.json({ thread: await parkQuestion(book, body) });
  } catch (error) {
    if (error instanceof ToolError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
});

/** Deletes a parked question by id. Only a question that is still parked can be deleted this way. */
export const DELETE = withBook(async ({ book, request }) => {
  const body = await readObject(request);
  if (!body || typeof body.id !== "string") return Response.json({ error: "Expected { id }." }, { status: 400 });
  await discardParked(book.id, body.id);
  return new Response(null, { status: 204 });
});
