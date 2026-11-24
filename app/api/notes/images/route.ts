import type { NextRequest } from "next/server";
import { IMAGE_MAX_BYTES, readImage, saveImage } from "@/lib/server/notes";
import { withNotes } from "@/lib/server/notes-route";

/** An image in the notes folder, by the link target written in the note at `from`. */
export const GET = (request: NextRequest) =>
  withNotes(async (notesDir) => {
    const query = request.nextUrl.searchParams;
    const image = await readImage(notesDir, query.get("target") ?? "", query.get("from") ?? "");
    if (!image) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(image.bytes), {
      headers: { "Content-Type": image.mediaType, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-cache" },
    });
  });

/** Saves the image in the body, pasted into the note at `from`, and answers with the link to insert. */
export const POST = (request: NextRequest) =>
  withNotes(async (notesDir) => {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > IMAGE_MAX_BYTES) return Response.json({ error: "Images up to 20 MB can be pasted." }, { status: 413 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length || bytes.length > IMAGE_MAX_BYTES) return Response.json({ error: "Images up to 20 MB can be pasted." }, { status: 413 });
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim();
    return Response.json(await saveImage(notesDir, request.nextUrl.searchParams.get("from"), type, bytes), { status: 201 });
  });
