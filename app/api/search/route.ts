import { connection } from "next/server";
import { libraryProblem } from "@/lib/server/library";
import { searchLibrary } from "@/lib/server/search";

const MAX_QUERY = 200;

/** Searches the whole library: `?q=` words. Also starts indexing any book whose text isn't searchable yet. */
export async function GET(request: Request) {
  await connection();
  const query = (new URL(request.url).searchParams.get("q") ?? "").slice(0, MAX_QUERY);
  try {
    const { books, indexing } = await searchLibrary(query);
    return Response.json({ books, indexing }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: libraryProblem(error) }, { status: 503 });
  }
}
