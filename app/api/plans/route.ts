import { randomUUID } from "node:crypto";
import { libraryBlock, libraryEntries, PLANNER_SYSTEM } from "@/lib/server/courses/planner";
import { updateCourses } from "@/lib/server/courses/store";
import { readSettings } from "@/lib/server/settings";
import { PROVIDERS, isProviderId, modelFor } from "@/lib/server/tutor/providers";
import type { Provider, TutorMessage, TutorTurn } from "@/lib/server/tutor/types";
import { MAX_MESSAGE, shortText } from "@/lib/server/validate";
import { readObject } from "@/lib/server/with-book";
import { parseRoadmap, resolveRoadmap, ROADMAP_FENCE, type Plan, type PlanMessage, type PlanStreamEvent, type Roadmap } from "@/lib/shared/courses";

const badRequest = (error: string) => Response.json({ error }, { status: 400 });

const tutorMessages = (messages: readonly PlanMessage[]): TutorMessage[] =>
  messages.filter((message) => message.content.trim()).map((message) => ({ role: message.role, content: message.content, images: [] }));

/** Runs one turn to the end, returning its text and session. */
const collect = async (provider: Provider, turn: TutorTurn, signal: AbortSignal, onText?: (delta: string) => void) => {
  let text = "";
  let sessionId = turn.sessionId;
  let failure: string | null = null;
  try {
    for await (const event of provider.run(turn, signal)) {
      if (event.type === "text") {
        text += event.delta;
        onText?.(event.delta);
      } else if (event.type === "session") sessionId = event.id;
      else if (event.type === "error") failure = event.message;
    }
  } catch (error) {
    if (!signal.aborted) failure = error instanceof Error ? error.message : "The tutor stopped unexpectedly.";
  }
  return { text, sessionId, failure };
};

/**
 * One turn of the home chat that plans a Course, streamed as newline-delimited PlanStreamEvent JSON: the plan
 * with the reader's message saved, text deltas, then the saved plan. An answer that ends in a roadmap block that
 * can't be read goes back to the tutor once with the reason; the fixed block replaces the broken one.
 */
export async function POST(request: Request) {
  const body = await readObject(request);
  if (!body) return badRequest("Expected a JSON object.");
  if (!isProviderId(body.provider)) return badRequest("Unknown provider.");
  const providerId = body.provider;
  const text = shortText(body.text, MAX_MESSAGE);
  if (!text) return badRequest("Say what you want to learn.");
  const planId = typeof body.planId === "string" ? body.planId : null;

  /* Read before the message is saved, so a failure here leaves the chat as it was. */
  const [settings, entries] = await Promise.all([readSettings(), libraryEntries()]);
  const now = new Date().toISOString();
  let plan: Plan | null = null;
  await updateCourses((current) => {
    const existing = planId ? current.plans.find((p) => p.id === planId) : undefined;
    if (planId && !existing) return current;
    const base: Plan = existing ?? { id: randomUUID(), provider: providerId, sessionId: null, messages: [], courseId: null, createdAt: now };
    plan = {
      ...base,
      /* Another tutor can't resume this one's session; it reads the whole chat instead. */
      provider: providerId,
      sessionId: base.provider === providerId ? base.sessionId : null,
      messages: [...base.messages, { role: "user", content: text, createdAt: now }],
    };
    return { ...current, plans: existing ? current.plans.map((p) => (p === existing ? plan! : p)) : [...current.plans, plan] };
  });
  if (!plan) return Response.json({ error: "That planning chat is gone." }, { status: 404 });
  const started: Plan = plan;

  const provider = PROVIDERS[providerId];
  const model = modelFor(settings.models, providerId);
  const system = `${PLANNER_SYSTEM}\n\n${libraryBlock(entries, started.messages)}`;

  const abort = new AbortController();
  if (request.signal.aborted) abort.abort();
  else request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: PlanStreamEvent) => {
        if (abort.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          /* The reader is gone; the answer is still saved below. */
        }
      };
      send({ type: "plan", plan: started });

      const messages = tutorMessages(started.messages);
      const first = await collect(provider, { system, messages, sessionId: started.sessionId, model }, abort.signal, (delta) => send({ type: "text", delta }));
      let answer = first.text;
      let sessionId = first.sessionId;
      let failure = first.failure;
      let roadmap: Roadmap | undefined;

      let draft = failure || abort.signal.aborted ? null : parseRoadmap(answer);
      if (typeof draft === "string") {
        send({ type: "fixing" });
        const repair = await collect(
          provider,
          {
            system,
            messages: [
              ...messages,
              { role: "assistant", content: answer, images: [] },
              { role: "user", content: `That roadmap couldn't be used. ${draft} Reply with only the corrected roadmap block, in the format you were given.`, images: [] },
            ],
            sessionId,
            model,
          },
          abort.signal,
        );
        sessionId = repair.sessionId;
        const fixed = parseRoadmap(repair.text);
        const block = ROADMAP_FENCE.exec(repair.text)?.[0];
        if (fixed && typeof fixed !== "string" && block) {
          answer = answer.replace(ROADMAP_FENCE, block);
          draft = fixed;
        } else {
          failure = `The roadmap couldn't be read. ${typeof fixed === "string" ? fixed : draft}`;
          draft = null;
        }
      }
      if (draft && typeof draft !== "string") roadmap = resolveRoadmap(draft, entries);

      const answered: PlanMessage = {
        role: "assistant",
        content: answer,
        createdAt: new Date().toISOString(),
        ...(abort.signal.aborted || first.failure ? { partial: true } : {}),
        ...(roadmap ? { roadmap } : {}),
      };
      let saved: Plan = started;
      await updateCourses((current) => ({
        ...current,
        plans: current.plans.map((p) => {
          if (p.id !== started.id) return p;
          saved = { ...p, sessionId, messages: [...p.messages, answered] };
          return saved;
        }),
      }));
      if (failure) send({ type: "error", message: failure });
      send({ type: "done", plan: saved });
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
