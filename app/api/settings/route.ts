import { connection } from "next/server";
import { readSettings, saveProvider } from "@/lib/server/settings";
import { isProviderId } from "@/lib/server/tutor/providers";
import { isObject } from "@/lib/server/validate";

export async function GET() {
  await connection();
  return Response.json(await readSettings());
}

/** Saves the chosen tutor provider. */
export async function PATCH(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  if (!isObject(body) || !isProviderId(body.provider)) {
    return Response.json({ error: "Expected { provider: \"claude\" | \"codex\" | \"api\" }." }, { status: 400 });
  }
  return Response.json(await saveProvider(body.provider));
}
