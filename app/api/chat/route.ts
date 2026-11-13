import { randomUUID } from "node:crypto";
import { findBook, type FoundBook } from "@/lib/server/library";
import { readSettings } from "@/lib/server/settings";
import { readBookState } from "@/lib/server/store";
import { openTurn, type TurnRequest } from "@/lib/server/turns";
import { CODEX_DEFAULT_MODEL } from "@/lib/server/tutor/codex";
import { ACTION_MESSAGES, buildTurn } from "@/lib/server/tutor/prompt";
import { PROVIDERS, isProviderId } from "@/lib/server/tutor/providers";
import { isObject, parseAnchor, shortText } from "@/lib/server/validate";
import { trimAfter, trimBefore } from "@/lib/shared/context";
import type { ChatStreamEvent, ProviderId, TutorAction } from "@/lib/shared/types";

const MAX_QUOTE = 12_000;
const MAX_MESSAGE = 8_000;
const ACTIONS: TutorAction[] = ["explain", "deeper", "ask"];
const DEFAULT_MODELS: Partial<Record<ProviderId, string>> = { codex: CODEX_DEFAULT_MODEL };

const badRequest = (error: string) => Response.json({ error }, { status: 400 });

/** The validated turn this request asks for. Nothing is read or saved yet. */
const parseTurn = (body: Record<string, unknown>, found: FoundBook, provider: ProviderId): TurnRequest | string => {
  if (body.kind === "new") {
    const now = new Date().toISOString();
    const action = ACTIONS.find((a) => a === body.action);
    const selection = isObject(body.selection) ? body.selection : null;
    const anchor = selection && parseAnchor(selection.anchor, found.book.format);
    const quote = selection && shortText(selection.text, MAX_QUOTE);
    if (!action || !selection || !anchor || !quote) return "Invalid selection.";
    const question = action === "ask" ? shortText(body.question, MAX_MESSAGE) : null;
    if (action === "ask" && !question) return "A question is required.";
    return {
      kind: "new",
      thread: {
        id: randomUUID(),
        anchor,
        quote,
        before: trimBefore(typeof selection.before === "string" ? selection.before : ""),
        after: trimAfter(typeof selection.after === "string" ? selection.after : ""),
        chapterTitle: shortText(selection.chapterTitle, 500),
        action,
        provider,
        sessionId: null,
        createdAt: now,
        messages: [{ role: "user", content: question ?? ACTION_MESSAGES[action as Exclude<TutorAction, "ask">], createdAt: now }],
      },
    };
  }
  if (typeof body.threadId !== "string") return "Invalid thread.";
  if (body.kind === "retry") return { kind: "retry", threadId: body.threadId };
  if (body.kind === "reply") {
    const text = shortText(body.text, MAX_MESSAGE);
    return text ? { kind: "reply", threadId: body.threadId, text } : "Invalid reply.";
  }
  return "Unknown request.";
};

/**
 * Streams the tutor's answer as newline-delimited ChatStreamEvent JSON: the
 * thread with the reader's saved message first, then text deltas, then the
 * saved thread. The answer is saved when the stream ends, marked partial if
 * the reader stopped it or left mid-answer.
 */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  if (!isObject(body)) return badRequest("Expected a JSON object.");
  if (!isProviderId(body.provider)) return badRequest("Unknown provider.");
  const providerId = body.provider;
  const found = await findBook(body.bookId);
  if (!found) return Response.json({ error: "Book not found." }, { status: 404 });

  const parsed = parseTurn(body, found, providerId);
  if (typeof parsed === "string") return badRequest(parsed);

  const [state, settings] = await Promise.all([readBookState(found.book.id), readSettings()]);
  const label = { title: state.meta?.title ?? found.book.fileTitle, author: state.meta?.author ?? found.book.fileAuthor };
  const model = settings.models[providerId] ?? DEFAULT_MODELS[providerId] ?? null;

  /* Waits for this thread's previous turn to finish saving, then saves the reader's message. */
  const turn = await openTurn(found.book.id, parsed, providerId);
  if (typeof turn === "string") return badRequest(turn);
  const { thread } = turn;
  const prompt = buildTurn(label, thread, model);

  const abort = new AbortController();
  if (request.signal.aborted) abort.abort();
  else request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        if (abort.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          /* The reader is gone; the answer is still saved below. */
        }
      };

      send({ type: "thread", thread });
      let answer = "";
      let sessionId = thread.sessionId;
      let failure: string | null = null;
      try {
        for await (const event of PROVIDERS[providerId].run(prompt, abort.signal)) {
          if (event.type === "text") {
            answer += event.delta;
            send({ type: "text", delta: event.delta });
          } else if (event.type === "session") {
            sessionId = event.id;
          } else {
            failure = event.message;
          }
        }
      } catch (error) {
        if (!abort.signal.aborted) failure = error instanceof Error ? error.message : "The tutor stopped unexpectedly.";
      }

      const saved = await turn.close({ text: answer, sessionId, partial: abort.signal.aborted || failure !== null });
      if (failure) send({ type: "error", message: failure });
      send({ type: "done", thread: saved });
      try {
        controller.close();
      } catch {
        /* Already closed by a cancel. */
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
