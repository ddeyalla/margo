import { stat } from "node:fs/promises";
import { getFolders } from "./config";
import { NotesPathError } from "./notes-folder";
import { GeneratedFileError } from "./notes";

/** Answers a notes request with the notes folder, or explains why there is none to use. Path errors become 400s. */
export const withNotes = async (handler: (notesDir: string) => Promise<Response>): Promise<Response> => {
  const notesDir = getFolders().notes.path;
  if (!notesDir) return Response.json({ error: "Choose a notes folder in settings first." }, { status: 409 });
  if (!(await stat(notesDir).catch(() => null))?.isDirectory()) {
    return Response.json({ error: `The notes folder "${notesDir}" is not there. Choose it again in settings.` }, { status: 409 });
  }
  try {
    return await handler(notesDir);
  } catch (error) {
    if (error instanceof GeneratedFileError) return Response.json({ error: error.message }, { status: 403 });
    if (error instanceof NotesPathError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
};
