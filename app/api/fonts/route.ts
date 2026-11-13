import { connection } from "next/server";
import { installedFonts } from "@/lib/server/fonts";

/** Lists the font families installed on this Mac, for the reading font picker. */
export async function GET() {
  await connection();
  return Response.json({ families: installedFonts() });
}
