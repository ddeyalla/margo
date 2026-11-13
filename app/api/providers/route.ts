import { connection } from "next/server";
import { probeProviders } from "@/lib/server/tutor/providers";

/** Each tutor provider with its status. `?fresh=1` skips the short probe cache. */
export async function GET(request: Request) {
  await connection();
  const fresh = new URL(request.url).searchParams.has("fresh");
  return Response.json(await probeProviders(fresh));
}
