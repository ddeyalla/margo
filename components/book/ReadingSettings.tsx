"use client";

import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@ui-sdk/react/popover";
import { Segmented } from "@/components/ui";
import type { ReadingFont, ReadingTheme } from "@/lib/shared/types";
import { FontPicker } from "./FontPicker";

const THEMES: { value: ReadingTheme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

const TEXT_STYLES: { value: "normal" | "bold-starts"; label: string; title?: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "bold-starts", label: "Bold starts", title: "Bionic-style reading: bolds the start of each word" },
];

/**
 * The EPUB's reading settings behind one "Aa" button, the way Apple Books groups them.
 * A font previewed but not chosen goes away when the popover closes, by Esc or otherwise.
 */
export function ReadingSettings({
  theme,
  onTheme,
  boldStarts,
  onBoldStarts,
  font,
  onPreviewFont,
  onFont,
}: {
  theme: ReadingTheme;
  onTheme(theme: ReadingTheme): void;
  boldStarts: boolean;
  onBoldStarts(on: boolean): void;
  font: ReadingFont;
  /** The font to show on the page for now, or undefined for the chosen one. */
  onPreviewFont(font: ReadingFont | undefined): void;
  onFont(font: ReadingFont): void;
}) {
  return (
    <Popover onOpenChange={(open) => open || onPreviewFont(undefined)}>
      <PopoverTrigger
        aria-label="Reading settings"
        title="Reading settings"
        className="press flex h-7 shrink-0 items-center justify-center rounded-sm px-2 font-reading text-[14px] leading-none text-dim outline-none transition-colors duration-[var(--duration-fast)] hover:bg-white/[0.06] hover:text-paper focus-visible:outline-2 focus-visible:outline-accent data-[open]:bg-panel-hover data-[open]:text-paper"
      >
        Aa
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={6}
        collisionPadding={12}
        initialFocus="[data-font-search]"
        aria-label="Reading settings"
        className="z-[60] flex w-[300px] max-w-[calc(100vw-24px)] flex-col gap-3 rounded-lg bg-panel-raised p-3 shadow-float outline-none ring-1 ring-line-strong"
      >
        <Setting label="Page">
          <Segmented label="Page colours" options={THEMES} value={theme} onChange={onTheme} />
        </Setting>
        <Setting label="Text">
          <Segmented
            label="Text style"
            options={TEXT_STYLES}
            value={boldStarts ? "bold-starts" : "normal"}
            onChange={(style) => onBoldStarts(style === "bold-starts")}
          />
        </Setting>
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <span className="text-label text-dim">Font</span>
          <FontPicker font={font} onPreview={onPreviewFont} onChoose={onFont} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-label text-dim">{label}</span>
      {children}
    </div>
  );
}
