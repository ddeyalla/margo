import { decideSuggestion, SuggestionError } from "@/lib/server/suggestions";
import { readObject } from "@/lib/server/with-book";
import { isDecision } from "@/lib/shared/suggestions";

/**
 * Decides a suggestion an agent proposed: `{ id, decision: "accept" | "reject" }`. Accepting makes the change it
 * proposes; rejecting only marks it. Answers with the suggestion as it now stands, or 409 when it can't be decided.
 */
export async function POST(request: Request) {
  const body = await readObject(request);
  if (!body || typeof body.id !== "string" || !isDecision(body.decision)) {
    return Response.json({ error: 'Expected { id, decision: "accept" | "reject" }.' }, { status: 400 });
  }
  try {
    return Response.json({ suggestion: await decideSuggestion(body.id, body.decision) });
  } catch (error) {
    if (error instanceof SuggestionError) return Response.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
