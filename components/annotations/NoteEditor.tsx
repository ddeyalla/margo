"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Button, Kbd } from "@/components/ui";

/** The tallest the body grows before it scrolls, in px. */
const MAX_BODY_HEIGHT = 360;

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
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const empty = !body.trim();

  /* Grows with the text, like the composer. */
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, MAX_BODY_HEIGHT)}px`;
  }, [body]);

  /* Open with the caret after any existing text. */
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  const save = () => {
    if (!empty) onSave(body.trim());
  };

  return (
    <div className="animate-rise rounded-lg bg-panel-raised p-3 ring-1 ring-white/[0.06]">
      <figure className="flex gap-2.5">
        <span aria-hidden className="w-[3px] shrink-0 rounded-full bg-highlight-strong/80" />
        <div className="min-w-0">
          <blockquote className="line-clamp-4 font-reading text-[13px] leading-relaxed text-prose">{quote}</blockquote>
          {where ? <figcaption className="mt-1 truncate text-[11px] text-dim">{where}</figcaption> : null}
        </div>
      </figure>
      <textarea
        ref={fieldRef}
        aria-label="Your note"
        placeholder="Write your note… Markdown and #tags work."
        value={body}
        rows={4}
        maxLength={20000}
        onChange={(event) => setBody(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
            event.preventDefault();
            save();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        className="mt-3 block w-full resize-none rounded-md bg-ink/60 px-3 py-2.5 text-[13px] leading-relaxed text-paper outline-none ring-1 ring-line transition-shadow duration-[var(--duration-fast)] placeholder:text-dim focus:ring-line-strong"
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
