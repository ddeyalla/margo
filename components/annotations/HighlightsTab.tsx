"use client";

import { Highlighter, NotebookPen, Trash2 } from "lucide-react";
import { EmptyState, IconButton, Kbd } from "@/components/ui";
import { byChapter, UNTITLED_SECTION } from "@/lib/shared/annotations";
import { placeLabel } from "@/lib/shared/place";
import type { Anchor, Highlight, Note, VaultStatus } from "@/lib/shared/types";
import { VaultLine } from "./VaultLine";

const when = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

const newestFirst = (a: Highlight, b: Highlight) => b.createdAt.localeCompare(a.createdAt);

/** Highlights by chapter in reading order, newest first within each chapter. */
export function HighlightsTab({
  highlights,
  notes,
  vault,
  onJump,
  onRemove,
  onOpenNote,
}: {
  highlights: Highlight[];
  notes: Note[];
  vault: VaultStatus | null;
  onJump(anchor: Anchor): void;
  onRemove(id: string): void;
  onOpenNote(noteId: string): void;
}) {
  if (!highlights.length) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <EmptyState icon={<Highlighter />} title="No highlights yet" body="Select a passage, then choose Highlight.">
          <p className="mt-1 flex items-center gap-1.5 text-label text-dim">
            or press <Kbd>⌘⇧H</Kbd>
          </p>
        </EmptyState>
        <VaultLine vault={vault} />
      </div>
    );
  }
  const noteFor = new Map(notes.filter((n) => n.highlightId).map((n) => [n.highlightId, n.id]));
  const groups = byChapter(highlights);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <p className="px-2 pb-1 pt-1 text-[11px] text-dim tabular-nums">
          {highlights.length} {highlights.length === 1 ? "highlight" : "highlights"} in this book
        </p>
        {groups.map((group, index) => (
          <section key={`${index}-${group.title}`} aria-label={group.title ?? UNTITLED_SECTION} className="pt-2">
            <h3 className="sticky top-0 z-10 truncate bg-panel px-2 py-1.5 text-label font-medium text-fog">
              {group.title ?? UNTITLED_SECTION}
            </h3>
            <ul className="flex flex-col gap-0.5">
              {[...group.items].sort(newestFirst).map((highlight) => {
                const noteId = noteFor.get(highlight.id);
                return (
                  <li key={highlight.id} className="group/item relative">
                    <button
                      type="button"
                      onClick={() => onJump(highlight.anchor)}
                      title="Go to this passage"
                      className="press flex w-full gap-2.5 rounded-lg bg-gradient-to-r from-highlight/40 from-0% to-transparent to-35% py-2 pl-2 pr-9 text-left transition-colors duration-[var(--duration-fast)] hover:bg-panel-raised focus-visible:bg-panel-raised"
                    >
                      <span aria-hidden className="w-[3px] shrink-0 self-stretch rounded-full bg-highlight-strong/80" />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-4 whitespace-pre-line font-reading text-[13px] leading-relaxed text-prose">
                          {highlight.quote}
                        </span>
                        <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] text-dim">
                          <span className="min-w-0 truncate">{placeLabel(highlight.chapterTitle, highlight.anchor) ?? UNTITLED_SECTION}</span>
                          <span aria-hidden className="size-0.5 shrink-0 rounded-full bg-dim/60" />
                          <span className="shrink-0 tabular-nums">{when.format(new Date(highlight.createdAt))}</span>
                        </span>
                      </span>
                    </button>
                    <div className="absolute right-1.5 top-1.5 flex flex-col gap-0.5">
                      <IconButton
                        label="Delete highlight"
                        size="sm"
                        onClick={() => onRemove(highlight.id)}
                        className="opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100"
                      >
                        <Trash2 />
                      </IconButton>
                      {noteId ? (
                        <IconButton label="Open its note" size="sm" onClick={() => onOpenNote(noteId)}>
                          <NotebookPen />
                        </IconButton>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <VaultLine vault={vault} />
    </div>
  );
}
