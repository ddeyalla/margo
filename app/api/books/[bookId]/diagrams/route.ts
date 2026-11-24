import { readSettings } from "@/lib/server/settings";
import { readBookState, updateBookState } from "@/lib/server/store";
import { repairDiagram } from "@/lib/server/tutor/diagram";
import { PROVIDERS, modelFor } from "@/lib/server/tutor/providers";
import { readObject, withBook } from "@/lib/server/with-book";
import { diagramFences, replaceDiagram } from "@/lib/shared/diagrams";
import type { ChatMessage } from "@/lib/shared/types";

const MAX_ERROR = 2_000;
const MAX_BROKEN = 5;

const badRequest = (error: string) => Response.json({ error }, { status: 400 });

const findAnswer = (messages: ChatMessage[], createdAt: string) =>
  messages.find((message) => message.role === "assistant" && message.createdAt === createdAt);

/**
 * Sends each diagram in an answer that the reader's browser could not parse back to the thread's tutor once, with
 * the parser's error, and saves the answer with the fixes in place. The browser parses, since Mermaid needs a DOM.
 * An answer is repaired at most once: a fix that still fails stays as it is and shows as code.
 * Body: { threadId, createdAt, broken: [{ index, error }] }, where index counts the answer's Mermaid fences.
 * Answers with the answer's text.
 */
export const POST = withBook(async ({ book, request }) => {
  const body = await readObject(request);
  if (!body || typeof body.threadId !== "string" || typeof body.createdAt !== "string" || !Array.isArray(body.broken)) {
    return badRequest("Expected { threadId, createdAt, broken }.");
  }
  const { threadId, createdAt } = body;
  const broken = body.broken
    .slice(0, MAX_BROKEN)
    .filter((item): item is { index: number; error: string } => Number.isInteger(item?.index) && typeof item?.error === "string");
  if (!broken.length) return badRequest("Name at least one broken diagram.");

  const [state, settings] = await Promise.all([readBookState(book.id), readSettings()]);
  const thread = state.threads.find((t) => t.id === threadId);
  const answer = thread && findAnswer(thread.messages, createdAt);
  if (!thread || !answer) return Response.json({ error: "That answer no longer exists." }, { status: 404 });
  if (answer.diagramsRepaired) return Response.json({ content: answer.content });

  const fences = diagramFences(answer.content);
  const provider = PROVIDERS[thread.provider];
  const model = modelFor(settings.models, thread.provider);
  const fixes = await Promise.all(
    broken.map(async ({ index, error }) => {
      const fence = fences[index];
      const source = fence && (await repairDiagram(provider, fence.source, error.slice(0, MAX_ERROR), model, request.signal));
      return source ? { index, from: fence.source, source } : null;
    }),
  );

  let content = answer.content;
  await updateBookState(book.id, (current) => ({
    ...current,
    threads: current.threads.map((t) => {
      if (t.id !== threadId) return t;
      return {
        ...t,
        messages: t.messages.map((message) => {
          if (message !== findAnswer(t.messages, createdAt) || message.diagramsRepaired) return message;
          /* Fixed against the answer as it is now, and only where the diagram is still the one that failed. */
          const fixed = fixes.reduce(
            (text, fix) => (fix && diagramFences(text)[fix.index]?.source === fix.from ? replaceDiagram(text, fix.index, fix.source) : text),
            message.content,
          );
          content = fixed;
          return { ...message, content: fixed, diagramsRepaired: true };
        }),
      };
    }),
  }));
  return Response.json({ content });
});
