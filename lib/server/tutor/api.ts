import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam, BetaUsage } from "@anthropic-ai/sdk/resources/beta/messages";
import type { TurnUsage } from "@/lib/shared/types";
import { imageBlock } from "./prompt";
import type { Provider, TutorEvent, TutorTurn } from "./types";

export const API_DEFAULT_MODEL = "claude-sonnet-5-5";

/**
 * The conversation as API messages. The API keeps no session, so every turn
 * carries its own images each time. Earlier turns come out the same on every
 * request, so the cached prefix still matches.
 */
export const apiMessages = (turn: TutorTurn): BetaMessageParam[] =>
  turn.messages.map(({ role, content, images }) => ({
    role,
    content: images.length ? [...images.map(imageBlock), { type: "text" as const, text: content }] : content,
  }));

/**
 * Dollars per million tokens, from Anthropic's price list as of 2026-11-03. A model not listed gets no cost
 * rather than a guess. Cache writes cost 1.25x input for the 5-minute cache and 2x for the hour; those
 * multipliers come from the docs, not from a bill.
 */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
};

/** What these tokens cost at list price, or null for a model not in the list. */
export const apiCost = (model: string, usage: BetaUsage): number | null => {
  const price = PRICES[model];
  if (!price) return null;
  const hour = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const fiveMinutes = (usage.cache_creation_input_tokens ?? 0) - hour;
  const dollars =
    usage.input_tokens * price.input +
    usage.output_tokens * price.output +
    (usage.cache_read_input_tokens ?? 0) * price.cacheRead +
    Math.max(0, fiveMinutes) * price.input * 1.25 +
    hour * price.input * 2;
  return dollars / 1_000_000;
};

/** Each model's context window, asked once per server. A failed lookup is tried again next time. */
const windows = ((globalThis as { [key: symbol]: unknown })[Symbol.for("rigg-learn.context-windows")] ??= new Map()) as Map<string, number>;

const contextWindow = async (client: Anthropic, model: string): Promise<number | null> => {
  const known = windows.get(model);
  if (known) return known;
  try {
    const window = (await client.models.retrieve(model)).max_input_tokens;
    if (window) windows.set(model, window);
    return window;
  } catch {
    return null;
  }
};

/** The usage of one API call. It is one call with no tools, so its input plus output is the conversation's size. */
export const apiUsage = (model: string, usage: BetaUsage, window: number | null): TurnUsage => {
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const costUsd = apiCost(model, usage);
  return {
    provider: "api",
    model,
    scope: "turn",
    costScope: "turn",
    sessionId: null,
    inputTokens: usage.input_tokens,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    outputTokens: usage.output_tokens,
    contextTokens: usage.input_tokens + cacheRead + cacheWrite + usage.output_tokens,
    contextWindow: window,
    costUsd,
    costBasis: costUsd === null ? null : "api",
  };
};

/** The key is read here and nowhere else. */
export const apiKey = () => process.env.ANTHROPIC_API_KEY?.trim() || null;

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
        messages: apiMessages(turn),
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
    /* Priced by the model that answered, which a fallback may have changed. */
    yield { type: "usage", usage: apiUsage(final.model, final.usage, await contextWindow(client, final.model)) };
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
