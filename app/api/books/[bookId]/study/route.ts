import { checkerFor } from "@/lib/server/check/provider";
import { readSettings } from "@/lib/server/settings";
import { BookClosedError, readBookState } from "@/lib/server/store";
import { answerStudy, overruleStudy, saveStudyDraft, startStudy, StudyError } from "@/lib/server/study";
import { PROVIDERS, isProviderId, modelFor } from "@/lib/server/tutor/providers";
import { readObject, withBook } from "@/lib/server/with-book";

const badRequest = (error: string) => Response.json({ error }, { status: 400 });

/**
 * The reader's turn on a passage, in the Go deeper sheet. `op` says what happens, and every answer is the saved thread:
 * - "start": `{ provider, selection }` or `{ provider, from }`. Takes as long as the tutor does when it writes a question.
 * - "answer": `{ provider, threadId, answer }`. Grades the answer with the checker and keeps the outcome.
 * - "draft": `{ threadId, draft }`. Keeps an unfinished answer.
 * - "overrule": `{ threadId, at, override }`, with "right", "wrong" or null. The reader's call on a grade.
 */
export const POST = withBook(async ({ book, request }) => {
  const body = await readObject(request);
  if (!body) return badRequest("Expected a JSON object.");
  const threadId = typeof body.threadId === "string" ? body.threadId : null;
  try {
    if (body.op === "start" || body.op === "answer") {
      if (!isProviderId(body.provider)) return badRequest("Unknown provider.");
      if (body.op === "answer") {
        if (!threadId) return badRequest("Invalid thread.");
        return Response.json({ thread: await answerStudy(book.id, threadId, body.answer, checkerFor(body.provider), request.signal) });
      }
      const [state, settings] = await Promise.all([readBookState(book.id), readSettings()]);
      const writer = {
        provider: PROVIDERS[body.provider],
        model: modelFor(settings.models, body.provider),
        book: { title: state.meta?.title ?? book.fileTitle, author: state.meta?.author ?? book.fileAuthor },
        signal: request.signal,
      };
      return Response.json({ thread: await startStudy(book, body, body.provider, writer) });
    }
    if (!threadId) return badRequest("Invalid thread.");
    if (body.op === "draft") return Response.json({ thread: await saveStudyDraft(book.id, threadId, body.draft) });
    if (body.op === "overrule") {
      const { override } = body;
      if (override !== "right" && override !== "wrong" && override !== null) return badRequest('"override" must be "right", "wrong" or null.');
      return Response.json({ thread: await overruleStudy(book.id, threadId, body.at, override) });
    }
    return badRequest("Unknown op.");
  } catch (error) {
    if (error instanceof StudyError) return badRequest(error.message);
    if (error instanceof BookClosedError) throw error;
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return Response.json({ error: error instanceof Error ? error.message : "The tutor could not be reached." }, { status: 502 });
  }
});
