import { listHighlightBlocks } from "@/lib/server/notes";
import { withNotes } from "@/lib/server/notes-route";

/** Every highlight in the per-book files, to embed in a note by its block id. */
export const GET = () => withNotes(async (notesDir) => Response.json({ highlights: await listHighlightBlocks(notesDir) }));
