import { connection } from "next/server";
import { version } from "@/package.json";

/** Lets the Mac app tell that this server is already running. */
export async function GET() {
  await connection();
  return Response.json({ app: "margo", version });
}
