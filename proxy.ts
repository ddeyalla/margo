import { NextResponse, type NextRequest } from "next/server";
import { refusal } from "@/lib/server/origin";

export function proxy(request: NextRequest) {
  const error = refusal({ method: request.method, host: request.headers.get("host"), origin: request.headers.get("origin") });
  return error ? NextResponse.json({ error }, { status: 403 }) : NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
