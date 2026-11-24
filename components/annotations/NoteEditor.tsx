"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorHost } from "@/components/notes/editor/host";
import { MarkdownEditor } from "@/components/notes/editor/MarkdownEditor";
import { Button, Kbd } from "@/components/ui";
import { fetchNotesIndex } from "@/lib/client/notes";
import type { NotesIndex } from "@/lib/shared/notes";

/* The notes folder's tags and note names, for completing #tags and [[links]]; read once per page, and none without a notes folder. */
let notesIndex: Promise<NotesIndex | null> | null = null;
let notesIndexValue: NotesIndex | null = null;
const loadNotesIndex = () =>
  (notesIndex ??= fetchNotesIndex()
    .then((index) => (notesIndexValue = index))
    .catch(() => null));

/** Writes or edits a note: the passage it belongs to above, the markdown body below. */
export function NoteEditor({
  quote,
  where,
  initialBody = "",
  saveLabel,
  onSave,
  onCancel,
}: {
  quote: string;
  where: string | null;
  initialBody?: string;
  saveLabel: string;
  onSave(body: string): void;
  onCancel(): void;
}) {
  const [body, setBody] = useState(initialBody);
  const empty = !body.trim();

  const save = () => {
    if (!empty) onSave(body.trim());
  };
  const keys = useRef({ save, onCancel });
  useEffect(() => {
    keys.current = { save, onCancel };
  });
  useEffect(() => void loadNotesIndex(), []);

  /* A note on a highlight lives in the app's data, so it has no file of its own: links and images don't open here. */
  const host = useMemo<EditorHost>(
    () => ({ index: () => notesIndexValue, onSubmit: () => keys.current.save(), onEscape: () => keys.current.onCancel() }),
    [],
  );

  return (
    <div className="animate-rise rounded-lg bg-panel-raised p-3 shadow-chip">
      <figure className="flex gap-2.5">
        <span aria-hidden className="w-[3px] shrink-0 rounded-full bg-highlight-strong/80" />
        <div className="min-w-0">
          <blockquote className="line-clamp-4 font-reading text-[13px] leading-relaxed text-prose">{quote}</blockquote>
          {where ? <figcaption className="mt-1 truncate text-[11px] text-dim">{where}</figcaption> : null}
        </div>
      </figure>
      <MarkdownEditor
        initialText={initialBody}
        onChange={setBody}
        host={host}
        label="Your note"
        placeholder="Write your note… / for commands, #tags work."
        maxLength={20000}
        compact
        autoFocus
        className="mt-3 max-h-[360px] min-h-[96px] overflow-y-auto rounded-md bg-ink/60 ring-1 ring-line transition-shadow duration-[var(--duration-fast)] focus-within:ring-line-strong"
      />
      <div className="mt-2.5 flex items-center gap-2">
        <p className="flex min-w-0 flex-1 items-center gap-1 truncate text-[11px] text-dim">
          <Kbd>⌘↵</Kbd> save · <Kbd>Esc</Kbd> cancel
        </p>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={empty} onClick={save}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
