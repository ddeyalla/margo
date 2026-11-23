import { connection } from "next/server";
import { checkFolder, readSettings, saveSettings } from "@/lib/server/settings";
import { isProviderId } from "@/lib/server/tutor/providers";
import { isObject } from "@/lib/server/validate";
import { isTutorModel } from "@/lib/shared/models";
import { isPanelTab, isReadingFont, isReadingMode, isReadingTheme, type SettingsChange } from "@/lib/shared/types";

export async function GET() {
  await connection();
  return Response.json(await readSettings());
}

/** Saves the chosen tutor provider, each tutor's model, the PDF page colours, the reading mode, the EPUB page colours, bold starts, the reading font, whether the chapters column is open, the side panel tab, the books folder, the notes folder, or any of them. A folder must be an absolute path to a folder that exists; anything else is a 400. */
export async function PATCH(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const change: SettingsChange = {};
  if (isObject(body) && isProviderId(body.provider)) change.provider = body.provider;
  if (isObject(body) && isReadingTheme(body.pdfPage)) change.pdfPage = body.pdfPage;
  if (isObject(body) && isReadingMode(body.readingMode)) change.readingMode = body.readingMode;
  if (isObject(body) && isReadingTheme(body.epubPage)) change.epubPage = body.epubPage;
  if (isObject(body) && typeof body.boldStarts === "boolean") change.boldStarts = body.boldStarts;
  if (isObject(body) && isReadingFont(body.readingFont)) change.readingFont = body.readingFont;
  if (isObject(body) && typeof body.chaptersOpen === "boolean") change.chaptersOpen = body.chaptersOpen;
  if (isObject(body) && isPanelTab(body.panelTab)) change.panelTab = body.panelTab;
  /* { models: { claude: "claude-sonnet-5-5" } } chooses a tutor's model; null goes back to its default. */
  if (isObject(body) && isObject(body.models)) {
    const models = { ...(await readSettings()).models };
    for (const [id, model] of Object.entries(body.models)) {
      if (!isProviderId(id) || (model !== null && !isTutorModel(id, model))) {
        return Response.json({ error: `"${String(model)}" is not a model the ${id} tutor offers.` }, { status: 400 });
      }
      if (model === null) delete models[id];
      else models[id] = model;
    }
    change.models = models;
  }
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
          "Expected { provider: \"claude\" | \"codex\" | \"api\" }, { models: { <provider>: \"<model id>\" | null } }, { pdfPage: \"auto\" | \"dark\" | \"light\" }, { readingMode: \"scroll\" | \"pages\" }, { epubPage: \"auto\" | \"dark\" | \"light\" }, { boldStarts: true | false }, { readingFont: \"<font family>\" | null }, { chaptersOpen: true | false }, { panelTab: \"chat\" | \"notes\" | \"highlights\" | \"cards\" }, { booksDir: \"/absolute/folder\" } or { notesDir: \"/absolute/folder\" | null }.",
      },
      { status: 400 },
    );
  }
  return Response.json(await saveSettings(change));
}
