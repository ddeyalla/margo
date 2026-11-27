import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/server/config";
import { cachedGlance, glance, warmGlance } from "@/lib/server/glance";
import { isObject, shortText } from "@/lib/server/validate";
import { readBody, withBook } from "@/lib/server/with-book";
import { parseGlance } from "@/lib/shared/glance";

/* The hover glance (a spike, see docs/plans/margo-rd-plan.md). Each glance is logged to glances.jsonl in the
   data folder, with its timings, so day-7 recall can be compared for words the reader glanced at and words they
   did not, and so the speed can be measured. */

const log = async (entry: Record<string, unknown>) => {
  const dataDir = getConfig().dataDir;
  await mkdir(dataDir, { recursive: true });
  await appendFile(path.join(/*turbopackIgnore: true*/ dataDir, "glances.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
};

/**
 * Body: { warm: true } starts the glance worker and answers 204. Or { term, sentence }: answers the glance as
 * plain text, streamed, in the three lines lib/shared/glance.ts reads. X-Glance: cached when it was saved before.
 */
export const POST = withBook(async ({ book, request }) => {
  const body = await readBody(request);
  if (isObject(body) && body.warm === true) {
    void warmGlance().catch(() => {});
    return new Response(null, { status: 204 });
  }
  const term = isObject(body) ? shortText(body.term, 80) : null;
  const sentence = isObject(body) ? shortText(body.sentence, 600) : null;
  if (!term || !sentence) return Response.json({ error: "Expected { term, sentence } or { warm: true }." }, { status: 400 });

  const saved = await cachedGlance(book.id, term);
  if (saved) {
    void log({ bookId: book.id, term, core: parseGlance(saved).core, cached: true, firstMs: 0, totalMs: 0 }).catch(() => {});
    return new Response(saved, { headers: { "Content-Type": "text/plain; charset=utf-8", "X-Glance": "cached" } });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sent = 0;
      try {
        const done = await glance(
          { bookId: book.id, book: book.fileTitle, term, sentence },
          (text) => {
            controller.enqueue(encoder.encode(text.slice(sent)));
            sent = text.length;
          },
          request.signal,
        );
        void log({ bookId: book.id, term, core: parseGlance(done.text).core, cached: false, via: done.via, firstMs: done.firstMs, totalMs: done.totalMs }).catch(() => {});
        controller.close();
      } catch (error) {
        controller.error(error instanceof Error ? error : new Error("The glance failed."));
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "X-Glance": "live", "Cache-Control": "no-store" } });
});
