import { connection } from "next/server";
import { readCapped } from "@/lib/server/body";
import { MAX_PCM_BYTES, MAX_SECONDS, parsePcm, transcribe } from "@/lib/server/speech";

/** Body: raw little-endian 32-bit float samples, mono, 16 kHz, at most 90 seconds. Answers { text }. */
export async function POST(request: Request) {
  await connection();
  const body = await readCapped(request, MAX_PCM_BYTES);
  if (!body) return Response.json({ error: `Recordings are limited to ${MAX_SECONDS} seconds.` }, { status: 413 });
  const parsed = parsePcm(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  try {
    const started = Date.now();
    const text = await transcribe(parsed.samples);
    return Response.json({ text, ms: Date.now() - started });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed.";
    return Response.json({ error: message }, { status: message.includes("not installed") ? 409 : 500 });
  }
}
