import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/server/config";
import { readSettings } from "@/lib/server/settings";
import { structured } from "@/lib/server/tutor/structured";
import { PROVIDERS, isProviderId, modelFor } from "@/lib/server/tutor/providers";
import { isObject, shortText } from "@/lib/server/validate";
import { readBody, withBook } from "@/lib/server/with-book";
import type { Glance } from "@/lib/shared/glance";

/* The hover glance (a spike, see docs/plans/margo-rd-plan.md): a short meaning for a word in its sentence.
   Each glance is logged to glances.jsonl in the data folder, so day-7 recall can be compared for words the
   reader glanced at and words they did not. */

const SYSTEM = `You explain one word or term from a book to its reader, in the sentence they found it in.
Reply with exactly one JSON object: {"gist": string, "example": string, "core": boolean}.
- gist: what the term means here, in one or two plain sentences, at most 40 words.
- example: one short concrete example, at most 25 words.
- core: true when the sentence is teaching this idea; false when the term is background the reader needs to follow it.`;

const parse = (reply: string): Glance | string => {
  const json = reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1);
  try {
    const value = JSON.parse(json) as unknown;
    if (isObject(value) && typeof value.gist === "string" && typeof value.example === "string" && typeof value.core === "boolean")
      return { gist: value.gist.slice(0, 400), example: value.example.slice(0, 300), core: value.core };
  } catch {
    /* Reported below. */
  }
  return "Expected {\"gist\": string, \"example\": string, \"core\": boolean}.";
};

/** Body: { term, sentence, provider }. Answers { gist, example, core }. */
export const POST = withBook(async ({ book, request }) => {
  const body = await readBody(request);
  const term = isObject(body) ? shortText(body.term, 80) : null;
  const sentence = isObject(body) ? shortText(body.sentence, 600) : null;
  if (!isObject(body) || !term || !sentence || !isProviderId(body.provider)) return Response.json({ error: "Expected { term, sentence, provider }." }, { status: 400 });
  const settings = await readSettings();
  const started = Date.now();
  try {
    const glance = await structured(
      PROVIDERS[body.provider],
      { system: SYSTEM, request: `Book: ${book.fileTitle}\nSentence: ${sentence}\nTerm: ${term}`, parse, failure: "The glance couldn't be read." },
      modelFor(settings.models, body.provider),
      request.signal,
    );
    const dataDir = getConfig().dataDir;
    await mkdir(dataDir, { recursive: true });
    await appendFile(path.join(dataDir, "glances.jsonl"), JSON.stringify({ at: new Date().toISOString(), bookId: book.id, term, core: glance.core, ms: Date.now() - started }) + "\n");
    return Response.json(glance);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The glance failed." }, { status: 502 });
  }
});
