import { connection } from "next/server";
import { speechStatus } from "@/lib/server/speech";

/** Whether the speech model is missing, downloading (with bytes done and in all) or ready. */
export async function GET() {
  await connection();
  return Response.json(await speechStatus());
}
