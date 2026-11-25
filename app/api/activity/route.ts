import { recordActivity } from "@/lib/server/activity";
import { isBookId } from "@/lib/server/library";
import { readObject } from "@/lib/server/with-book";
import { isActivityKind, reportSeconds } from "@/lib/shared/mastery";

/**
 * Time spent learning: `{ bookId, kind: "reading" | "review" | "quiz", seconds }`, sent by the book page about every
 * half minute while it is in view and in use. Seconds are capped per report and per day, and land on today's study day.
 */
export async function POST(request: Request) {
  const body = await readObject(request);
  const seconds = reportSeconds(body?.seconds);
  if (!body || !isBookId(body.bookId) || !isActivityKind(body.kind) || seconds === null) {
    return Response.json({ error: "Expected { bookId, kind, seconds }." }, { status: 400 });
  }
  await recordActivity(body.bookId, body.kind, seconds);
  return new Response(null, { status: 204 });
}
