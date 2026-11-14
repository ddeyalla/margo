"use client";

import { useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowUp, ImagePlus, Square } from "lucide-react";
import { IMAGE_TYPES } from "@/lib/shared/attachments";
import { insertAtCaret } from "@/lib/shared/dictation";
import { DraftImages } from "./Images";
import { DictationNote, MicButton } from "./MicButton";
import { useDictation } from "./useDictation";
import type { ImageDraft } from "./useImageDraft";
import type { MessageDraft } from "./useTutor";

const MAX_TEXT = 8000;
/** The box grows from one line to this many, then scrolls. */
const MAX_LINES = 8;

/**
 * The raised card at the foot of the chat. Its round white send button is the
 * panel's one primary button; it turns into Stop while an answer streams.
 * Images come in by paste, by the attach button, or by a drop the panel
 * forwards to `images`; a message may be images alone.
 */
export function Composer({
  placeholder,
  disabledReason,
  sending,
  images,
  onSend,
  onStop,
}: {
  placeholder: string;
  /** Why nothing can be sent; the box is disabled and shows this. */
  disabledReason: string | null;
  sending: boolean;
  images: ImageDraft;
  onSend(draft: MessageDraft): void;
  onStop(): void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /* Where the caret goes once dictated words are in the box. */
  const caret = useRef<number | null>(null);
  const dictation = useDictation((words) => {
    const input = inputRef.current;
    if (!input) return;
    const next = insertAtCaret(input.value, input.selectionStart, input.selectionEnd, words, MAX_TEXT);
    caret.current = next.caret;
    setText(next.value);
  });
  const hasContent = text.trim().length > 0 || images.ready.length > 0;
  const canSend = !disabledReason && !sending && !images.uploading && !images.failed && hasContent;
  const problem = images.notice ?? images.images.flatMap((image) => (image.state.status === "failed" ? [image.state.error] : []))[0] ?? null;

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const style = getComputedStyle(input);
    const line = parseFloat(style.lineHeight) || 20;
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    input.style.height = "0px";
    input.style.height = `${Math.max(line + padding, Math.min(input.scrollHeight, line * MAX_LINES + padding))}px`;
  }, [text]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input || caret.current === null) return;
    input.focus();
    input.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [text]);

  const send = () => {
    if (!canSend) return;
    onSend({ text: text.trim(), attachments: images.ready });
    setText("");
    images.clear();
  };

  return (
    <div className="shrink-0 px-3 pb-3 pt-1">
      <div className="rounded-xl bg-panel-raised shadow-float ring-1 ring-inset ring-white/[0.05] transition-shadow duration-[var(--duration-base)] focus-within:ring-white/[0.14]">
        {images.images.length ? <DraftImages images={images.images} onRemove={images.remove} /> : null}
        {problem ? (
          <p role="alert" className="px-3.5 pt-2 text-[11px] leading-relaxed text-danger">
            {problem}
          </p>
        ) : null}
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          maxLength={MAX_TEXT}
          disabled={disabledReason !== null}
          aria-label="Message the tutor"
          placeholder={disabledReason ?? placeholder}
          onChange={(event) => setText(event.currentTarget.value)}
          onPaste={(event) => {
            const files = [...event.clipboardData.files];
            if (!files.some((file) => file.type.startsWith("image/"))) return;
            /* Copying an image from a web page can bring its text too; keep that paste for the box. */
            if (!event.clipboardData.types.includes("text/plain")) event.preventDefault();
            images.add(files);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
          className="block w-full resize-none overflow-y-auto bg-transparent px-3.5 pb-1 pt-3 text-body text-paper outline-none placeholder:text-dim disabled:cursor-not-allowed"
        />
        <DictationNote dictation={dictation} className="px-3.5 pb-1.5" />
        <div className="flex items-center gap-1.5 px-2 pb-2">
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            multiple
            hidden
            onChange={(event) => {
              images.add([...(event.currentTarget.files ?? [])]);
              event.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            aria-label="Attach images"
            title="Attach images. You can also paste or drop them."
            disabled={disabledReason !== null}
            onClick={() => fileRef.current?.click()}
            className="press grid size-7 shrink-0 place-items-center rounded-full text-dim transition-colors duration-[var(--duration-fast)] hover:bg-white/[0.06] hover:text-paper focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40"
          >
            <ImagePlus className="size-4" aria-hidden />
          </button>
          <span aria-hidden className="min-w-0 flex-1 truncate text-[11px] text-dim">
            {sending ? "Answering…" : images.uploading ? "Attaching…" : "⏎ send · ⇧⏎ new line"}
          </span>
          <MicButton dictation={dictation} disabled={disabledReason !== null} />
          <button
            type="button"
            aria-label={sending ? "Stop the answer" : "Send"}
            title={sending ? "Stop" : "Send (Enter)"}
            disabled={!sending && !canSend}
            onClick={sending ? onStop : send}
            className={clsx(
              "press grid size-7 shrink-0 place-items-center rounded-full transition-colors duration-[var(--duration-fast)]",
              sending || canSend ? "bg-accent text-ink hover:bg-white" : "bg-white/[0.06] text-dim",
            )}
          >
            {sending ? <Square size={10} fill="currentColor" aria-hidden /> : <ArrowUp size={15} strokeWidth={2.25} aria-hidden />}
          </button>
        </div>
      </div>
    </div>
  );
}
