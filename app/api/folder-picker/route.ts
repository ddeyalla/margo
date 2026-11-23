import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** What the dialog asks for each folder. */
const PROMPTS = {
  books: "Choose the folder that holds your EPUB and PDF books",
  notes: "Choose the folder for your notes, such as one in your Obsidian vault",
} as const;

/** AppleScript's "User canceled." */
const CANCELLED = /-128/;

/**
 * Opens the Mac's own folder dialog and answers with the chosen folder's path, or null when cancelled. The server
 * runs on the reader's Mac, so this gives a browser tab the same Finder picker the Mac app has; a page alone can
 * never learn a folder's full path. The proxy limits /api to this app's own pages.
 */
export async function POST(request: Request) {
  if (process.platform !== "darwin") return Response.json({ error: "The folder dialog needs a Mac." }, { status: 501 });
  const body = (await request.json().catch(() => null)) as { kind?: unknown } | null;
  const kind = body?.kind === "notes" ? "notes" : "books";
  try {
    /* `activate` brings the dialog in front of the browser rather than behind it. */
    const { stdout } = await run("osascript", ["-e", "activate", "-e", `POSIX path of (choose folder with prompt "${PROMPTS[kind]}")`], {
      timeout: 10 * 60_000,
    });
    const chosen = stdout.trim().replace(/(.)\/$/, "$1");
    return Response.json({ path: chosen || null });
  } catch (error) {
    if (CANCELLED.test(String((error as { stderr?: unknown }).stderr ?? ""))) return Response.json({ path: null });
    return Response.json({ error: "The folder dialog could not open." }, { status: 500 });
  }
}
