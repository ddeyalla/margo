import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSettings, saveSettings } from "@/lib/server/settings";

describe("settings", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rigg-learn-settings-"));
    await mkdir(path.join(dir, "data"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    vi.stubEnv("BOOKS_DIR", dir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("starts with the chapters closed and the chat tab", async () => {
    expect(await readSettings()).toMatchObject({ chaptersOpen: false, panelTab: "chat" });
  });

  it("keeps the chapters column and the side panel tab", async () => {
    await saveSettings({ chaptersOpen: true });
    await saveSettings({ panelTab: "highlights" });
    expect(await readSettings()).toMatchObject({ chaptersOpen: true, panelTab: "highlights" });
  });

  it("falls back for values it doesn't know", async () => {
    await writeFile(path.join(dir, "data", "settings.json"), JSON.stringify({ chaptersOpen: "yes", panelTab: "cards" }));
    expect(await readSettings()).toMatchObject({ chaptersOpen: false, panelTab: "chat" });
  });
});
