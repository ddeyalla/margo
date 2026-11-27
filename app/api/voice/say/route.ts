import { connection } from "next/server";
import { MAX_TEXT, say } from "@/lib/server/voice";
import { voiceOf } from "@/lib/shared/voices";

/**
 * Body: { text, voice, speed }. Answers the speech as raw little-endian 32-bit float samples, mono,
 * with the sample rate in the X-Sample-Rate header.
 */
export async function POST(request: Request) {
  await connection();
  const body = (await request.json().catch(() => null)) as { text?: unknown; voice?: unknown; speed?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const speed = typeof body?.speed === "number" && body.speed >= 0.5 && body.speed <= 2.5 ? body.speed : 1;
  if (!text || text.length > MAX_TEXT) return Response.json({ error: `Expected { text } of 1 to ${MAX_TEXT} characters.` }, { status: 400 });
  try {
    const voice = voiceOf(body?.voice);
    const { samples, sampleRate } = await say(text, voice.speaker, voice.lexicon, speed);
    return new Response(samples.slice().buffer, {
      headers: { "Content-Type": "application/octet-stream", "X-Sample-Rate": String(sampleRate) },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Speaking failed.";
    return Response.json({ error: message }, { status: message.includes("not installed") ? 409 : 500 });
  }
}
