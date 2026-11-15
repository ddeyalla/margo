import { connection } from "next/server";
import { isBookId, readLibrary } from "@/lib/server/library";
import { listMissing, missingBookResponse, rebind } from "@/lib/server/missing-books";
import { readObject } from "@/lib/server/with-book";

/** The books that have saved data but no file in the books folder, and the books that could take their place. */
export async function GET() {
  await connection();
  try {
    return Response.json(await listMissing(await readLibrary()));
  } catch (error) {
    return missingBookResponse(error);
  }
}

/** Relinks a missing book to a file the library found: `{ id, targetId }`, where `targetId` is that file's current id. */
export async function POST(request: Request) {
  const body = await readObject(request);
  if (!body || !isBookId(body.id) || !isBookId(body.targetId)) {
    return Response.json({ error: "Expected { id, targetId }, each a book id." }, { status: 400 });
  }
  try {
    await rebind(body.id, body.targetId);
  } catch (error) {
    return missingBookResponse(error);
  }
  return new Response(null, { status: 204 });
}
