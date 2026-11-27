import { connection } from "next/server";
import { checkFolder, readSettings, saveSettings } from "@/lib/server/settings";
import { isProviderId } from "@/lib/server/tutor/providers";
import { isObject } from "@/lib/server/validate";
import { isTutorModel } from "@/lib/shared/models";
import { cleanLoad, isLibraryView, isLoadLimit, isPanelTab, isReadAloudRate, isReadAloudVoice, isReadingFont, isReadingMode, isReadingTheme, type SettingsChange } from "@/lib/shared/types";

export async function GET() {
  await connection();
  return Response.json(await readSettings());
}

/** Saves the chosen tutor provider, each tutor's model, the PDF page colours, the reading mode, the EPUB page colours, bold starts, the reading font, whether the chapters column is open, the side panel tab, the read-along voice and speed, the library view, the books folder, the notes folder, or any of them. A folder must be an absolute path to a folder that exists; anything else is a 400. */
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
  if (isObject(body) && "readAloudVoice" in body && isReadAloudVoice(body.readAloudVoice)) change.readAloudVoice = body.readAloudVoice;
  if (isObject(body) && isReadAloudRate(body.readAloudRate)) change.readAloudRate = body.readAloudRate;
  if (isObject(body) && isLibraryView(body.libraryView)) change.libraryView = body.libraryView;
  /* { dailyLoad: { newPerDay: 20, reviewsPerDay: 60 } } sets each limit named, whole numbers from 0 to 500; one left out keeps its saved value. */
  if (isObject(body) && "dailyLoad" in body) {
    const load = isObject(body.dailyLoad) ? body.dailyLoad : null;
    const given = load ? (["newPerDay", "reviewsPerDay"] as const).filter((key) => key in load) : [];
    if (!load || !given.length || !given.every((key) => isLoadLimit(load[key]))) {
      return Response.json({ error: "dailyLoad takes { newPerDay?, reviewsPerDay? }, each a whole number from 0 to 500." }, { status: 400 });
    }
    change.dailyLoad = cleanLoad(load, (await readSettings()).dailyLoad);
  }
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
          "Expected { provider: \"claude\" | \"codex\" | \"api\" }, { models: { <provider>: \"<model id>\" | null } }, { pdfPage: \"auto\" | \"dark\" | \"light\" }, { readingMode: \"scroll\" | \"pages\" }, { epubPage: \"auto\" | \"dark\" | \"light\" }, { boldStarts: true | false }, { readingFont: \"<font family>\" | null }, { chaptersOpen: true | false }, { panelTab: \"chat\" | \"notes\" | \"highlights\" | \"cards\" }, { readAloudVoice: \"heart\" | \"michael\" | \"emma\" | null }, { readAloudRate: 0.75 | 1 | 1.25 | 1.5 | 1.75 | 2 }, { libraryView: \"grid\" | \"shelf\" }, { dailyLoad: { newPerDay: 20, reviewsPerDay: 60 } }, { booksDir: \"/absolute/folder\" } or { notesDir: \"/absolute/folder\" | null }.",
      },
      { status: 400 },
    );
  }
  return Response.json(await saveSettings(change));
}
