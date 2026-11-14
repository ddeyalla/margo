import { connection } from "next/server";
import { startDownload } from "@/lib/server/speech";

/** Starts the model download, about 490 MB, and answers at once. Poll GET /api/speech for progress. A second ask while one runs joins it. */
export async function POST() {
  await connection();
  return Response.json(await startDownload(), { status: 202 });
}
