import { connection } from "next/server";
import { readSettings, saveSettings } from "@/lib/server/settings";
import { isProviderId } from "@/lib/server/tutor/providers";
import { isObject } from "@/lib/server/validate";
import { isReadingFont, isReadingMode, isReadingTheme, type SettingsChange } from "@/lib/shared/types";

export async function GET() {
  await connection();
  return Response.json(await readSettings());
}

/** Saves the chosen tutor provider, the PDF dark pages switch, the reading mode, the EPUB page colours, bold starts, the reading font, or any of them. */
export async function PATCH(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const change: SettingsChange = {};
  if (isObject(body) && isProviderId(body.provider)) change.provider = body.provider;
  if (isObject(body) && typeof body.pdfDarkPages === "boolean") change.pdfDarkPages = body.pdfDarkPages;
  if (isObject(body) && isReadingMode(body.readingMode)) change.readingMode = body.readingMode;
  if (isObject(body) && isReadingTheme(body.epubTheme)) change.epubTheme = body.epubTheme;
  if (isObject(body) && typeof body.boldStarts === "boolean") change.boldStarts = body.boldStarts;
  if (isObject(body) && isReadingFont(body.readingFont)) change.readingFont = body.readingFont;
  if (!Object.keys(change).length) {
    return Response.json(
      {
        error:
          "Expected { provider: \"claude\" | \"codex\" | \"api\" }, { pdfDarkPages: true | false }, { readingMode: \"scroll\" | \"pages\" }, { epubTheme: \"dark\" | \"light\" }, { boldStarts: true | false } or { readingFont: \"<font family>\" | null }.",
      },
      { status: 400 },
    );
  }
  return Response.json(await saveSettings(change));
}
