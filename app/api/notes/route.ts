import { listNotes } from "@/lib/server/notes";
import { withNotes } from "@/lib/server/notes-route";

/** Every note in the notes folder, the app's per-book files, and the tags in use. */
export const GET = () => withNotes(async (notesDir) => Response.json(await listNotes(notesDir)));
