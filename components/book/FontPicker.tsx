"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import { Check, Search } from "lucide-react";
import { cssFamily, fontGroups, fontInEffect, fontLabel } from "@/components/reader/fonts";
import { fetchFonts } from "@/lib/client/api";
import type { ReadingFont } from "@/lib/shared/types";

/* Asked for once per page load, and again after a failure. */
let fontList: Promise<string[]> | null = null;
const loadFonts = () =>
  (fontList ??= fetchFonts().catch(() => {
    fontList = null;
    return [];
  }));

/**
 * A searchable list of the fonts on this Mac, each name set in its own face. Hovering a font or
 * arrowing to it previews it on the page; clicking it or pressing Return chooses it.
 */
export function FontPicker({
  font,
  onPreview,
  onChoose,
}: {
  font: ReadingFont;
  onPreview(font: ReadingFont): void;
  onChoose(font: ReadingFont): void;
}) {
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [installed, setInstalled] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void loadFonts().then((families) => live && setInstalled(families));
    return () => {
      live = false;
    };
  }, []);

  const current = fontInEffect(font, installed);
  const { suggested, others } = useMemo(() => {
    const groups = fontGroups(installed ?? []);
    const words = query.trim().toLocaleLowerCase();
    const matches = (option: ReadingFont) => fontLabel(option).toLocaleLowerCase().includes(words);
    return { suggested: [null, ...groups.suggested].filter(matches), others: groups.others.filter(matches) };
  }, [installed, query]);
  const options = [...suggested, ...others];
  const activeIndex = active ?? options.indexOf(current);
  const optionId = (index: number) => `${id}-font-${index}`;

  /* Brings the chosen font into view once the full list has arrived. */
  useEffect(() => {
    if (installed) listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "center" });
  }, [installed]);

  const moveTo = (index: number) => {
    if (!options.length) return;
    const next = Math.max(0, Math.min(options.length - 1, index));
    setActive(next);
    onPreview(options[next]);
    document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveTo(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing && activeIndex >= 0 && activeIndex < options.length) {
      event.preventDefault();
      onChoose(options[activeIndex]);
    }
  };

  const row = (option: ReadingFont, index: number) => (
    <div
      key={option ?? ""}
      id={optionId(index)}
      role="option"
      aria-selected={option === current}
      onPointerEnter={() => {
        setActive(index);
        onPreview(option);
      }}
      onClick={() => onChoose(option)}
      style={{ fontFamily: option === null ? "var(--font-literata)" : cssFamily(option) }}
      className={clsx(
        "flex h-8 shrink-0 cursor-default items-center gap-2 rounded-sm px-2 text-[15px] leading-none text-paper [contain-intrinsic-size:auto_32px] [content-visibility:auto]",
        index === activeIndex && "bg-panel-hover",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{fontLabel(option)}</span>
      {option === current ? <Check aria-hidden className="size-3.5 shrink-0 text-accent" /> : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      <label className="flex h-8 items-center gap-2 rounded-sm bg-panel px-2 ring-1 ring-line focus-within:ring-line-strong">
        <Search aria-hidden className="size-3.5 shrink-0 text-dim" />
        <input
          data-font-search
          role="combobox"
          aria-label="Search fonts"
          aria-expanded="true"
          aria-controls={`${id}-fonts`}
          aria-activedescendant={activeIndex >= 0 && activeIndex < options.length ? optionId(activeIndex) : undefined}
          placeholder="Search fonts"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setActive(event.currentTarget.value.trim() ? 0 : null);
          }}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-body text-paper outline-none placeholder:text-dim"
        />
      </label>
      <div ref={listRef} id={`${id}-fonts`} role="listbox" aria-label="Fonts" className="-mx-1 flex max-h-64 flex-col overflow-y-auto px-1">
        {suggested.length ? (
          <div role="group" aria-label="Suggested" className="flex flex-col">
            {suggested.map((option, index) => row(option, index))}
          </div>
        ) : null}
        {others.length ? (
          <div role="group" aria-label="All fonts" className="flex flex-col">
            <div aria-hidden className="mt-1 border-t border-line px-2 pb-1 pt-2 text-label text-dim">
              All fonts
            </div>
            {others.map((option, index) => row(option, suggested.length + index))}
          </div>
        ) : null}
        {installed === null ? <p className="px-2 py-2 text-label text-dim">Finding this Mac’s fonts…</p> : null}
        {installed && !options.length ? <p className="px-2 py-2 text-label text-dim">No font matches “{query.trim()}”.</p> : null}
      </div>
      <button
        type="button"
        disabled={current === null}
        onClick={() => onChoose(null)}
        className="press self-start rounded-xs text-label text-dim outline-none transition-colors duration-[var(--duration-fast)] hover:text-paper focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40"
      >
        Reset to Literata
      </button>
    </div>
  );
}
