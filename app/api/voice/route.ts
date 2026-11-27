import { connection } from "next/server";
import { voiceStatus } from "@/lib/server/voice";

/** Whether the reading voice is missing, downloading (with bytes done and in all) or ready. */
export async function GET() {
  await connection();
  return Response.json(await voiceStatus());
}
