import { changeAnnotations, parseChange } from "@/lib/server/annotations";
import { getConfig } from "@/lib/server/config";
import { readBody, withBook } from "@/lib/server/with-book";
import type { AnnotationMethod } from "@/lib/shared/annotations";

/** Saves one highlight or note change, then answers with every annotation and the markdown copy's status. */
const handle = (method: AnnotationMethod) =>
  withBook(async ({ book, request }) => {
    const change = parseChange(method, await readBody(request), book.format);
    if (typeof change === "string") return Response.json({ error: change }, { status: 400 });
    const { dataDir, notesDir } = getConfig();
    return Response.json(await changeAnnotations(book, change, { dataDir, notesDir }));
  });

/* The body is one AnnotationChange: add-highlight and add-note go as POST, edit-note as PATCH, the removals as DELETE. */
export const POST = handle("POST");
export const PATCH = handle("PATCH");
export const DELETE = handle("DELETE");
