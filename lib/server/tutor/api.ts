import Anthropic from "@anthropic-ai/sdk";
import type { Provider, TutorEvent, TutorTurn } from "./types";

export const API_DEFAULT_MODEL = "claude-sonnet-5-5";

/** The key is read here and nowhere else. */
const apiKey = () => process.env.ANTHROPIC_API_KEY?.trim() || null;

async function* run(turn: TutorTurn, signal: AbortSignal): AsyncGenerator<TutorEvent> {
  const key = apiKey();
  if (!key) {
    yield { type: "error", message: "Add ANTHROPIC_API_KEY to .env.local to use the API." };
    return;
  }
  const client = new Anthropic({ apiKey: key });
  try {
    const stream = client.beta.messages.stream(
      {
        model: turn.model ?? API_DEFAULT_MODEL,
        max_tokens: 64000,
        output_config: { effort: "medium" },
        system: turn.system,
        messages: turn.messages,
        /* Retry on a backup model if this one declines the request. */
        fallbacks: "default",
        betas: ["server-side-fallback-2026-07-01"],
        /* Follow-ups reuse the cached passage instead of paying for it again. */
        cache_control: { type: "ephemeral" },
      },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text", delta: event.delta.text };
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") yield { type: "error", message: "The model declined to answer this." };
  } catch (error) {
    if (signal.aborted || error instanceof Anthropic.APIUserAbortError) return;
    yield { type: "error", message: error instanceof Anthropic.APIError ? error.message : "The API request failed." };
  }
}

export const api: Provider = {
  id: "api",
  label: "Anthropic API",
  async probe() {
    return apiKey()
      ? { status: "ready", detail: API_DEFAULT_MODEL, version: null }
      : { status: "unavailable", detail: "Add ANTHROPIC_API_KEY to .env.local to use the API.", version: null };
  },
  run,
};
