"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowLeft, AudioLines, BookOpen, Focus, Moon, PanelRight, Search, Sun, SunMoon, TableOfContents } from "lucide-react";
import { ProviderPicker } from "@/components/chat/ProviderPicker";
import { SEARCH_SHORTCUT } from "@/components/search/SearchDialog";
import { IconButton, Segmented } from "@/components/ui";
import type { AppSettings, BookFormat, ProviderId, ProviderInfo, ReadingFont, ReadingMode, ReadingTheme } from "@/lib/shared/types";
import { useChapter, type PlaceStore } from "./place";
import { FocusButton } from "./FocusSession";
import { ReadingSettings } from "./ReadingSettings";
import type { BookSettings, ChooseSetting } from "./useBookSettings";

export const TOC_SHORTCUT = "⌘⇧L";
export const SPOTLIGHT_SHORTCUT = "⌘⇧F";
export const READ_ALOUD_SHORTCUT = "⌘⇧S";

const MODES: { value: ReadingMode; label: string }[] = [
  { value: "scroll", label: "Scroll" },
  { value: "pages", label: "Pages" },
];

/* A PDF keeps its own page colours; "dark" here is the switch that darkens white pages. */
const PDF_THEMES: { value: ReadingTheme; label: string; icon: ReactNode }[] = [
  { value: "auto", label: "Show white pages dark when the app is dark", icon: <SunMoon /> },
  { value: "dark", label: "Show white pages dark", icon: <Moon /> },
  { value: "light", label: "Show pages in their own colours", icon: <Sun /> },
];

/** The bar above the book. The spotlight clears it away. */
export function BookHeader({
  title,
  spot,
  format,
  failed,
  settings,
  choose,
  onToggleChapters,
  onPreviewFont,
  onFont,
  providers,
  provider,
  onProvider,
  models,
  onModel,
  spotlight,
  onSpotlight,
  readingAloud,
  onReadAloud,
  focusing,
  onFocus,
  panelId,
  panelOpen,
  onTogglePanel,
  onSearch,
}: {
  title: string;
  spot: PlaceStore;
  format: BookFormat;
  /** The book could not be opened, so the controls that need a page are off. */
  failed: boolean;
  settings: BookSettings;
  choose: ChooseSetting;
  onToggleChapters(): void;
  onPreviewFont(font: ReadingFont | undefined): void;
  onFont(font: ReadingFont): void;
  providers: ProviderInfo[] | null;
  provider: ProviderId | null;
  onProvider(id: ProviderId): void;
  models: AppSettings["models"];
  onModel(id: ProviderId, model: string | null): void;
  spotlight: boolean;
  onSpotlight(): void;
  /** Read-along's controls are open. */
  readingAloud: boolean;
  onReadAloud(): void;
  /** A focus session is on: the header clears away, as for the spotlight. */
  focusing: boolean;
  onFocus(minutes: number): void;
  panelId: string;
  panelOpen: boolean;
  onTogglePanel(): void;
  onSearch(): void;
}) {
  const tocOpen = settings.chaptersOpen;
  return (
    <header className={clsx("h-12 shrink-0 items-center gap-1.5 px-2.5", spotlight || focusing ? "hidden" : "flex")}>
      <Link
        href="/"
        aria-label="Back to library"
        title="Back to library"
        className="press flex size-7 shrink-0 items-center justify-center rounded-sm text-dim transition-colors duration-[var(--duration-fast)] hover:bg-tint hover:text-paper"
      >
        <ArrowLeft className="size-4" />
      </Link>
      <IconButton
        label={tocOpen ? `Hide chapters (${TOC_SHORTCUT})` : `Show chapters (${TOC_SHORTCUT})`}
        active={tocOpen}
        disabled={failed}
        onClick={onToggleChapters}
        data-toc-toggle
      >
        <TableOfContents />
      </IconButton>
      <div className="ml-1 flex min-w-0 flex-1 items-center gap-2.5">
        <h1 className="flex h-7 min-w-0 max-w-[min(360px,50%)] shrink-0 items-center gap-2 rounded-full bg-panel-raised px-3 text-body font-semibold text-paper shadow-chip">
          <BookOpen aria-hidden className="size-3.5 shrink-0 text-dim" />
          <span className="truncate">{title}</span>
        </h1>
        <ChapterLabel spot={spot} />
      </div>
      <IconButton label={`Search the library (${SEARCH_SHORTCUT})`} onClick={onSearch}>
        <Search />
      </IconButton>
      <div className="shrink-0">
        <ProviderPicker providers={providers} current={provider} onSelect={onProvider} models={models} onModel={onModel} />
      </div>
      <Segmented label="Reading mode" options={MODES} value={settings.readingMode} onChange={(mode) => choose("readingMode", mode)} />
      {format === "epub" ? (
        <ReadingSettings
          theme={settings.epubPage}
          onTheme={(theme) => choose("epubPage", theme)}
          boldStarts={settings.boldStarts}
          onBoldStarts={(on) => choose("boldStarts", on)}
          font={settings.readingFont}
          onPreviewFont={onPreviewFont}
          onFont={onFont}
        />
      ) : (
        <Segmented label="Page colours" options={PDF_THEMES} value={settings.pdfPage} onChange={(theme) => choose("pdfPage", theme)} />
      )}
      <FocusButton disabled={failed} onStart={onFocus} />
      {/* A disabled button takes no pointer, so the reason it is off sits on this wrapper. */}
      <span title={format === "epub" ? undefined : "Spotlight works in EPUB books for now"} className="inline-flex">
        <IconButton
          label={format === "epub" ? `Spotlight: dim all but the paragraph you're reading (${SPOTLIGHT_SHORTCUT})` : "Spotlight works in EPUB books for now"}
          active={spotlight}
          disabled={format !== "epub" || failed}
          onClick={onSpotlight}
        >
          <Focus />
        </IconButton>
      </span>
      <span title={format === "epub" ? undefined : "Read aloud works in EPUB books for now"} className="inline-flex">
        <IconButton
          label={format === "epub" ? `${readingAloud ? "Stop reading aloud" : "Read aloud, lighting each word"} (${READ_ALOUD_SHORTCUT})` : "Read aloud works in EPUB books for now"}
          active={readingAloud}
          disabled={format !== "epub" || failed}
          onClick={onReadAloud}
        >
          <AudioLines />
        </IconButton>
      </span>
      <IconButton
        label={panelOpen ? "Hide the tutor panel (⌘\\)" : "Show the tutor panel (⌘\\)"}
        active={panelOpen}
        aria-controls={panelId}
        onClick={onTogglePanel}
      >
        <PanelRight />
      </IconButton>
    </header>
  );
}

/** The chapter being read, beside the title. Subscribes on its own, so only a new chapter re-renders it. */
function ChapterLabel({ spot }: { spot: PlaceStore }) {
  const chapter = useChapter(spot);
  return chapter ? <span className="truncate text-label text-dim">{chapter.label}</span> : null;
}
