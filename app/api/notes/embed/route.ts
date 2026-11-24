import type { NextRequest } from "next/server";
import { readEmbed } from "@/lib/server/notes";
import { withNotes } from "@/lib/server/notes-route";

/** What ![[target#subpath]] shows in the note at `from`: a block, a section or a whole note. */
export const GET = (request: NextRequest) =>
  withNotes(async (notesDir) => {
    const query = request.nextUrl.searchParams;
    const embed = await readEmbed(notesDir, query.get("target") ?? "", query.get("subpath") || null, query.get("from") ?? "");
    return embed ? Response.json(embed) : Response.json({ error: "Nothing in the notes folder matches that embed." }, { status: 404 });
  });
