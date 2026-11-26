import type { Provider, TutorMessage } from "./types";

/** One whole reply from a provider, in a conversation of its own: no session is resumed and none is kept. */
export const complete = async (provider: Provider, system: string, messages: TutorMessage[], model: string | null, signal: AbortSignal): Promise<string> => {
  let text = "";
  for await (const event of provider.run({ system, messages, sessionId: null, model }, signal)) {
    if (event.type === "text") text += event.delta;
    else if (event.type === "error") throw new Error(event.message);
  }
  return text;
};

/** What to ask for, and how to read the reply: `parse` gives the value, or a sentence saying what was wrong with it. */
export interface StructuredRequest<T extends object> {
  system: string;
  request: string;
  parse: (reply: string) => T | string;
  /** How a reply that can't be read twice is reported, such as "The tutor's quiz couldn't be read." */
  failure: string;
}

/**
 * Asks for a reply in a fixed JSON shape. A reply that can't be read goes back once with the reason, in the same
 * conversation, rather than starting over; a second one that can't be read is an error.
 */
export const structured = async <T extends object>(
  provider: Provider,
  { system, request, parse, failure }: StructuredRequest<T>,
  model: string | null,
  signal: AbortSignal,
): Promise<T> => {
  const messages: TutorMessage[] = [{ role: "user", content: request, images: [] }];
  const first = await complete(provider, system, messages, model, signal);
  const parsed = parse(first);
  if (typeof parsed !== "string") return parsed;
  const repair: TutorMessage[] = [
    ...messages,
    { role: "assistant", content: first, images: [] },
    { role: "user", content: `That reply couldn't be used. ${parsed} Reply again with exactly one JSON object in the format you were given.`, images: [] },
  ];
  const second = parse(await complete(provider, system, repair, model, signal));
  if (typeof second === "string") throw new Error(`${failure} ${second}`);
  return second;
};

/** Runs `work` over every item, at most `limit` at once, and gives the results in the items' order. */
export const pooled = async <T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index]);
      }
    }),
  );
  return results;
};
