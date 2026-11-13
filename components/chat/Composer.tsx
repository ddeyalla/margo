"use client";

import { useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowUp, Square } from "lucide-react";

const MAX_TEXT = 8000;
/** The box grows from one line to this many, then scrolls. */
const MAX_LINES = 8;

/** The raised card at the foot of the chat. Its round white send button is the panel's one primary button; it turns into Stop while an answer streams. */
export function Composer({
  placeholder,
  disabledReason,
  sending,
  onSend,
  onStop,
}: {
  placeholder: string;
  /** Why nothing can be sent; the box is disabled and shows this. */
  disabledReason: string | null;
  sending: boolean;
  onSend(text: string): void;
  onStop(): void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const canSend = !disabledReason && !sending && text.trim().length > 0;

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const style = getComputedStyle(input);
    const line = parseFloat(style.lineHeight) || 20;
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    input.style.height = "0px";
    input.style.height = `${Math.max(line + padding, Math.min(input.scrollHeight, line * MAX_LINES + padding))}px`;
  }, [text]);

  const send = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
  };

  return (
    <div className="shrink-0 px-3 pb-3 pt-1">
      <div className="rounded-xl bg-panel-raised shadow-float ring-1 ring-inset ring-white/[0.05] transition-shadow duration-[var(--duration-base)] focus-within:ring-white/[0.14]">
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          maxLength={MAX_TEXT}
          disabled={disabledReason !== null}
          aria-label="Message the tutor"
          placeholder={disabledReason ?? placeholder}
          onChange={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
          className="block w-full resize-none overflow-y-auto bg-transparent px-3.5 pb-1 pt-3 text-body text-paper outline-none placeholder:text-dim disabled:cursor-not-allowed"
        />
        <div className="flex items-center gap-2 px-2 pb-2 pl-3.5">
          <span aria-hidden className="min-w-0 flex-1 truncate text-[11px] text-dim">
            {sending ? "Answering…" : "⏎ send · ⇧⏎ new line"}
          </span>
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
