"use client";

import { useEffect, useRef, useState } from "react";
import { NotebookPen, Pencil, Trash2 } from "lucide-react";
import { Markdown } from "@/components/chat/Markdown";
import { Button, EmptyState, IconButton } from "@/components/ui";
import { formatShortDate, newestFirst } from "@/lib/shared/annotations";
import { placeLabel } from "@/lib/shared/place";
import type { Anchor, Note, SelectionContext, VaultStatus } from "@/lib/shared/types";
import { ChapterSections } from "./ChapterSections";
import { NoteEditor } from "./NoteEditor";
import { VaultLine } from "./VaultLine";

/** The note being written: a new one on a selected passage, or an existing one. */
export type NoteDraft = { kind: "new"; selection: SelectionContext } | { kind: "edit"; id: string };

/** Notes by chapter in reading order, newest first within each chapter, rendered as markdown. */
export function NotesTab({
  notes,
  draft,
  focus,
  vault,
  onDraft,
  onAdd,
  onEdit,
  onRemove,
  onJump,
}: {
  notes: Note[];
  draft: NoteDraft | null;
  /** A note to bring into view, such as one opened from its highlight; `at` repeats the request. */
  focus: { id: string; at: number } | null;
  vault: VaultStatus | null;
  onDraft(draft: NoteDraft | null): void;
  onAdd(selection: SelectionContext, body: string): void;
  onEdit(id: string, body: string): void;
  onRemove(id: string): void;
  onJump(anchor: Anchor): void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focus) listRef.current?.querySelector(`[data-note="${focus.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus]);

  const fresh = draft?.kind === "new" ? draft.selection : null;
  const editingId = draft?.kind === "edit" ? draft.id : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {fresh ? (
          <div className="px-1 pb-2 pt-1">
            <NoteEditor
              key={`${fresh.text}-${JSON.stringify(fresh.anchor)}`}
              quote={fresh.text}
              where={placeLabel(fresh.chapterTitle, fresh.anchor)}
              saveLabel="Save note"
              onSave={(body) => onAdd(fresh, body)}
              onCancel={() => onDraft(null)}
            />
          </div>
        ) : null}
        {notes.length ? (
          <ChapterSections items={notes} within={newestFirst} count={{ one: "note", many: "notes" }} listClassName="flex flex-col gap-1">
            {(note) =>
              note.id === editingId ? (
                <li key={note.id} data-note={note.id} className="px-1 py-1">
                  <NoteEditor
                    quote={note.quote}
                    where={placeLabel(note.chapterTitle, note.anchor)}
                    initialBody={note.body}
                    saveLabel="Save"
                    onSave={(body) => onEdit(note.id, body)}
                    onCancel={() => onDraft(null)}
                  />
                </li>
              ) : (
                <NoteCard
                  key={note.id}
                  note={note}
                  flash={focus?.id === note.id ? focus.at : null}
                  onJump={() => onJump(note.anchor)}
                  onEdit={() => onDraft({ kind: "edit", id: note.id })}
                  onRemove={() => onRemove(note.id)}
                />
              )
            }
          </ChapterSections>
        ) : fresh ? null : (
          <EmptyState icon={<NotebookPen />} title="No notes yet" body="Select a passage, then choose Note to write about it." />
        )}
      </div>
      <VaultLine vault={vault} />
    </div>
  );
}

function NoteCard({
  note,
  flash,
  onJump,
  onEdit,
  onRemove,
}: {
  note: Note;
  /** Set when this note was just opened from its highlight; a new value replays the glow. */
  flash: number | null;
  onJump(): void;
  onEdit(): void;
  onRemove(): void;
}) {
  const [confirming, setConfirming] = useState(false);
  const edited = note.updatedAt !== note.createdAt;
  return (
    <li
      data-note={note.id}
      className="group/note relative rounded-lg px-2 py-2 transition-colors duration-[var(--duration-fast)] hover:bg-tint"
    >
      {flash !== null ? (
        <span key={flash} aria-hidden className="animate-glow pointer-events-none absolute inset-0 rounded-lg bg-highlight/40 ring-1 ring-highlight-strong/50" />
      ) : null}
      <button type="button" onClick={onJump} title="Go to this passage" className="press flex w-full gap-2.5 pr-14 text-left">
        <span aria-hidden className="w-[3px] shrink-0 self-stretch rounded-full bg-highlight-strong/70" />
        <span className="line-clamp-3 min-w-0 font-reading text-body leading-relaxed text-fog transition-colors duration-[var(--duration-fast)] hover:text-prose">
          {note.quote}
        </span>
      </button>
      <div className="mt-2 pl-[13px]">
        <Markdown text={note.body} />
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 pl-[13px] text-caption text-dim">
        {note.tags.map((tag) => (
          <span key={tag} className="rounded-xs bg-tint px-1.5 py-px text-fog">
            #{tag}
          </span>
        ))}
        <span className="tabular-nums">
          {formatShortDate(note.createdAt)}
          {edited ? " · edited" : ""}
        </span>
      </div>
      {confirming ? (
        <div className="animate-rise mt-2 flex items-center gap-2 pl-[13px]">
          <p className="flex-1 text-label text-fog">Delete this note?</p>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Keep
          </Button>
          <Button variant="outline" className="text-danger hover:text-danger" onClick={onRemove}>
            Delete
          </Button>
        </div>
      ) : null}
      <div className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-0 transition-opacity duration-[var(--duration-fast)] focus-within:opacity-100 group-hover/note:opacity-100">
        <IconButton label="Edit note" size="sm" onClick={onEdit}>
          <Pencil />
        </IconButton>
        <IconButton label="Delete note" size="sm" onClick={() => setConfirming(true)}>
          <Trash2 />
        </IconButton>
      </div>
    </li>
  );
}
