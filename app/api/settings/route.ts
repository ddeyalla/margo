import { connection } from "next/server";
import { checkFolder, readSettings, saveSettings } from "@/lib/server/settings";
import { isProviderId } from "@/lib/server/tutor/providers";
import { isObject } from "@/lib/server/validate";
import { isPanelTab, isReadingFont, isReadingMode, isReadingTheme, type SettingsChange } from "@/lib/shared/types";

export async function GET() {
  await connection();
  return Response.json(await readSettings());
}

/** Saves the chosen tutor provider, the PDF dark pages switch, the reading mode, the EPUB page colours, bold starts, the reading font, whether the chapters column is open, the side panel tab, the books folder, the notes folder, or any of them. A folder must be an absolute path to a folder that exists; anything else is a 400. */
export async function PATCH(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const change: SettingsChange = {};
  if (isObject(body) && isProviderId(body.provider)) change.provider = body.provider;
  if (isObject(body) && typeof body.pdfDarkPages === "boolean") change.pdfDarkPages = body.pdfDarkPages;
  if (isObject(body) && isReadingMode(body.readingMode)) change.readingMode = body.readingMode;
  if (isObject(body) && isReadingTheme(body.epubTheme)) change.epubTheme = body.epubTheme;
  if (isObject(body) && typeof body.boldStarts === "boolean") change.boldStarts = body.boldStarts;
  if (isObject(body) && isReadingFont(body.readingFont)) change.readingFont = body.readingFont;
  if (isObject(body) && typeof body.chaptersOpen === "boolean") change.chaptersOpen = body.chaptersOpen;
  if (isObject(body) && isPanelTab(body.panelTab)) change.panelTab = body.panelTab;
  for (const key of ["booksDir", "notesDir"] as const) {
    if (!isObject(body) || !(key in body)) continue;
    const checked = await checkFolder(key, body[key], key === "notesDir");
    if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });
    change[key] = checked.path;
  }
  if (!Object.keys(change).length) {
    return Response.json(
      {
        error:
          "Expected { provider: \"claude\" | \"codex\" | \"api\" }, { pdfDarkPages: true | false }, { readingMode: \"scroll\" | \"pages\" }, { epubTheme: \"dark\" | \"light\" }, { boldStarts: true | false }, { readingFont: \"<font family>\" | null }, { chaptersOpen: true | false } { panelTab: \"chat\" | \"notes\" | \"highlights\" }, { booksDir: \"/absolute/folder\" } or { notesDir: \"/absolute/folder\" | null }.",
      },
      { status: 400 },
    );
  }
  return Response.json(await saveSettings(change));
}
