import { ToolError } from "@/lib/server/tools/schema";
import { runTool } from "@/lib/server/tools/tool";
import { logActivity } from "@/lib/server/tools/write";
import { readBody } from "@/lib/server/with-book";

/**
 * Time spent learning: `{ bookId, kind: "reading" | "review" | "quiz", seconds }`, sent by the book page about every
 * half minute while it is in view and in use. Seconds are capped per report and per day, and land on today's study day.
 */
export async function POST(request: Request) {
  try {
    await runTool(logActivity, await readBody(request), { caller: "app", now: new Date() });
  } catch (error) {
    if (error instanceof ToolError) return Response.json({ error: "Expected { bookId, kind, seconds }." }, { status: 400 });
    throw error;
  }
  return new Response(null, { status: 204 });
}
