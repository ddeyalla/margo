import { connection } from "next/server";
import { MAX_PCM_BYTES, parsePcm, transcribe } from "@/lib/server/speech";

/** Body: raw little-endian 32-bit float samples, mono, 16 kHz, at most 90 seconds. Answers { text }. */
export async function POST(request: Request) {
  await connection();
  if (Number(request.headers.get("content-length")) > MAX_PCM_BYTES) {
    return Response.json({ error: "Recordings are limited to 90 seconds." }, { status: 413 });
  }
  const parsed = parsePcm(await request.arrayBuffer());
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
