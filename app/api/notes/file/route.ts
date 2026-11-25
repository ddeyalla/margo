import type { NextRequest } from "next/server";
import { createNote, noteHash, openNote, saveNote } from "@/lib/server/notes";
import { withNotes } from "@/lib/server/notes-route";
import { readObject } from "@/lib/server/with-book";
import { NOTE_MAX_CHARS } from "@/lib/shared/notes";

/**
 * One note, with its version and backlinks. With `since`, only whether it changed: `{ hash }` when the file's
 * version is no longer `since` (null when it was deleted), `{ unchanged: true }` otherwise.
 */
export const GET = (request: NextRequest) =>
  withNotes(async (notesDir) => {
    const query = request.nextUrl.searchParams;
    const since = query.get("since");
    if (since) {
      const hash = await noteHash(notesDir, query.get("path"));
      return Response.json(hash === since ? { unchanged: true } : { hash });
    }
    const note = await openNote(notesDir, query.get("path"));
    return note ? Response.json(note) : Response.json({ error: "That note is not in the notes folder." }, { status: 404 });
  });

/** Saves `{ path, text, baseHash }`, keeping both versions when the file changed on disk since `baseHash`. */
export const PUT = (request: Request) =>
  withNotes(async (notesDir) => {
    const body = await readObject(request);
    if (!body || typeof body.text !== "string" || typeof body.baseHash !== "string" || body.text.length > NOTE_MAX_CHARS) {
      return Response.json({ error: "Send { path, text, baseHash }." }, { status: 400 });
    }
    return Response.json(await saveNote(notesDir, body.path, body.text, body.baseHash));
  });

/** Creates `{ name, folder?, text? }` under a name no file has, and answers with its path. */
export const POST = (request: Request) =>
  withNotes(async (notesDir) => {
    const body = (await readObject(request)) ?? {};
    const text = typeof body.text === "string" ? body.text.slice(0, NOTE_MAX_CHARS) : "";
    return Response.json({ path: await createNote(notesDir, body.name, body.folder ?? "", text) }, { status: 201 });
  });
