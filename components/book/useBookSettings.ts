"use client";

import { useCallback, useRef, useState } from "react";
import { patchSettings } from "@/lib/client/api";
import type { AppSettings } from "@/lib/shared/types";

/** The saved settings a book page starts from. */
export type BookSettings = Pick<AppSettings, "provider" | "models" | "pdfPage" | "readingMode" | "epubPage" | "boldStarts" | "readingFont" | "chaptersOpen" | "panelTab" | "readAloudVoice" | "readAloudRate">;

/* The tutor is chosen and saved by useProviders. */
export type ReaderSetting = Exclude<keyof BookSettings, "provider">;

export type ChooseSetting = <K extends ReaderSetting>(key: K, value: BookSettings[K]) => void;

/**
 * The book page's settings, and `choose`, which shows a new value and saves it. Choosing the value already
 * shown saves nothing. `showUnsaved` changes what is shown without remembering it for next time.
 */
export function useBookSettings(saved: BookSettings) {
  const [settings, setSettings] = useState(saved);
  /* Kept beside the state so `choose` can stay the same function from render to render. */
  const latest = useRef(saved);

  const showUnsaved: ChooseSetting = useCallback((key, value) => {
    latest.current = { ...latest.current, [key]: value };
    setSettings(latest.current);
  }, []);

  const choose: ChooseSetting = useCallback(
    (key, value) => {
      if (latest.current[key] === value) return;
      showUnsaved(key, value);
      void patchSettings({ [key]: value });
    },
    [showUnsaved],
  );

  return [settings, choose, showUnsaved] as const;
}
