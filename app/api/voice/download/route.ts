import { connection } from "next/server";
import { startVoiceDownload } from "@/lib/server/voice";

/** Starts the voice download, about 320 MB, and answers at once. Poll GET /api/voice for progress. */
export async function POST() {
  await connection();
  return Response.json(await startVoiceDownload(), { status: 202 });
}
