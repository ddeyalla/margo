"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import clsx from "clsx";
import { TableOfContents, X } from "lucide-react";
import type { TocEntry } from "@/components/reader/types";
import { EmptyState, IconButton, Spinner } from "@/components/ui";
import type { BookFormat } from "@/lib/shared/types";

/**
 * The book's table of contents. Docked, it is a column beside the book that
 * stays open while you read; on a pane too narrow for that it slides over the
 * book with a scrim and closes on any press outside it. The chapter being read
 * is marked.
 */
export function TocDrawer({
  toc,
  current,
  format,
  shortcut,
  open,
  docked,
  onSelect,
  onClose,
}: {
  /** Null until the reader has opened the book. */
  toc: TocEntry[] | null;
  current: TocEntry | null;
  format: BookFormat;
  shortcut: string;
  open: boolean;
  docked: boolean;
  onSelect(entry: TocEntry): void;
  onClose(): void;
}) {
  const navRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLOListElement>(null);

  /* Open on the chapter being read, with focus on it so the keyboard starts there. */
  useLayoutEffect(() => {
    if (!open) return;
    const target = listRef.current?.querySelector<HTMLButtonElement>("[aria-current]") ?? listRef.current?.querySelector("button");
    target?.scrollIntoView({ block: "center" });
    (target ?? navRef.current)?.focus({ preventScroll: true });
  }, [open, toc]);

  /* While docked the list stays up as you read, so keep the chapter being read in sight. */
  useEffect(() => {
    if (open) listRef.current?.querySelector("[aria-current]")?.scrollIntoView({ block: "nearest" });
  }, [open, current]);

  useEffect(() => {
    if (!open || docked) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element;
      /* The header button that toggles the drawer handles its own press. */
      if (!navRef.current?.contains(target) && !target.closest?.("[data-toc-toggle]")) onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, docked, onClose]);

  const nav = (
    <nav
      ref={navRef}
      aria-label="Chapters"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      className={clsx(
        "flex flex-col bg-panel outline-none",
        docked
          ? "h-full w-[var(--toc-width)] shadow-[inset_-1px_0_var(--color-line)]"
          : "animate-drawer absolute inset-y-0 left-0 z-30 w-[min(var(--toc-width),calc(100%-48px))] shadow-dialog ring-1 ring-white/[0.06]",
      )}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 pl-4 pr-2">
        <h2 className="text-section text-paper">Chapters</h2>
        {toc?.length ? <span className="text-label text-dim tabular-nums">{toc.length}</span> : null}
        <span className="flex-1" />
        <IconButton label={`Close chapters (${shortcut})`} size="sm" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      {toc === null ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-label text-dim">
          <Spinner />
          Reading the contents
        </div>
      ) : toc.length === 0 ? (
        <EmptyState
          icon={<TableOfContents />}
          title="No chapters to show"
          body={format === "pdf" ? "This PDF has no outline." : "This book has no table of contents."}
        />
      ) : (
        <ol ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {toc.map((entry, index) => {
            const isCurrent = entry === current;
            return (
              <li key={index}>
                <button
                  type="button"
                  aria-current={isCurrent ? "location" : undefined}
                  onClick={() => onSelect(entry)}
                  style={{ paddingLeft: 10 + entry.depth * 14 }}
                  className={clsx(
                    "press flex w-full items-baseline gap-3 rounded-sm py-1.5 pr-2 text-left leading-snug outline-none transition-colors duration-[var(--duration-fast)] focus-visible:outline-2 focus-visible:outline-accent",
                    entry.depth === 0 ? "text-[13px]" : "text-label",
                    isCurrent
                      ? "bg-panel-hover text-paper"
                      : clsx("hover:bg-white/[0.04] hover:text-paper", entry.depth === 0 ? "text-fog" : "text-dim"),
                  )}
                >
                  <span className="min-w-0 flex-1">{entry.label}</span>
                  {entry.target.kind === "pdf" ? (
                    <span className="shrink-0 text-[11px] text-dim tabular-nums">{entry.target.page}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </nav>
  );

  if (docked) return nav;
  if (!open) return null;
  return (
    <>
      <div aria-hidden className="animate-fade absolute inset-0 z-30 bg-black/40" />
      {nav}
    </>
  );
}
