"use client";

import { useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { ArrowUp, BookOpenText, Highlighter, Layers, MessageCircleQuestion, NotebookPen, Sparkles } from "lucide-react";
import { Toolbar, ToolbarButton, ToolbarGroup, ToolbarInput, ToolbarSeparator } from "@ui-sdk/react/toolbar";
import type { SelectionContext } from "@/lib/shared/types";
import type { SelectionRect } from "./types";

/** Space between the toolbar and the selection, and between the toolbar and the reader's edges. */
const GAP = 8;
const EDGE = 8;

export interface SelectionToolbarHandle {
  /** The reader's latest selection rect; null hides the toolbar. Fed straight from the reader so the workspace never re-renders on scroll. */
  update(rect: SelectionRect | null): void;
}

interface SelectionToolbarProps {
  ref: Ref<SelectionToolbarHandle>;
  /** The reader area, in viewport coordinates. The toolbar stays inside it. */
  bounds(): DOMRect | null;
  readSelection(): SelectionContext | null;
  /** Why the tutor can't answer right now; the actions are disabled and say this. */
  disabledReason: string | null;
  onAction(action: "explain" | "deeper", selection: SelectionContext): void;
  onAsk(question: string, selection: SelectionContext): void;
  onDismiss(): void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

const itemClass =
  "press inline-flex h-7 shrink-0 select-none items-center gap-1.5 rounded-sm px-2 text-label text-fog outline-none transition-[color,background-color,scale,opacity] duration-[var(--duration-fast)] ease-out hover:bg-white/[0.06] hover:text-paper focus-visible:bg-white/[0.06] focus-visible:text-paper data-[disabled]:opacity-40 data-[disabled]:hover:bg-transparent data-[disabled]:hover:text-fog [&>svg]:size-3.5 [&>svg]:shrink-0";

function Action({ icon, label, title, disabled, onPress }: { icon: ReactNode; label: string; title?: string; disabled: boolean; onPress(): void }) {
  return (
    <ToolbarButton className={itemClass} disabled={disabled} title={title} onClick={onPress}>
      {icon}
      {label}
    </ToolbarButton>
  );
}

/**
 * Floats above the selected passage (below it when there's no room) and offers
 * the tutor's actions. Ask… swaps the buttons for an inline question field.
 */
export function SelectionToolbar({ ref, bounds, readSelection, disabledReason, onAction, onAsk, onDismiss }: SelectionToolbarProps) {
  const [rect, setRect] = useState<SelectionRect | null>(null);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  /* Read once the reader reaches for the toolbar, before focus can move and clear a PDF selection. */
  const snapshot = useRef<SelectionContext | null>(null);
  const askingRef = useRef(false);

  const reset = () => {
    askingRef.current = false;
    snapshot.current = null;
    setAsking(false);
    setQuestion("");
    setRect(null);
  };

  useImperativeHandle(ref, () => ({
    update(next) {
      /* Focusing the question field clears a PDF selection; the snapshot holds it until the question is sent. */
      if (askingRef.current) return;
      if (!next) snapshot.current = null;
      setRect(next);
    },
  }));

  useLayoutEffect(() => {
    const box = boxRef.current;
    const area = bounds();
    if (!box || !rect || !area) return;
    const outside = rect.top + rect.height < area.top || rect.top > area.bottom;
    const { offsetWidth: width, offsetHeight: height } = box;
    let top = rect.top - height - GAP;
    if (top < area.top + EDGE) top = rect.top + rect.height + GAP;
    top = clamp(top, area.top + EDGE, area.bottom - height - EDGE);
    const left = clamp(rect.left + rect.width / 2 - width / 2, area.left + EDGE, area.right - width - EDGE);
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
    box.style.visibility = outside ? "hidden" : "visible";
  }, [rect, asking, bounds]);

  if (!rect) return null;

  const take = () => (snapshot.current ??= readSelection());

  const act = (action: "explain" | "deeper") => {
    const selection = take();
    if (!selection) return;
    reset();
    onAction(action, selection);
  };

  const submit = () => {
    const selection = snapshot.current;
    const text = question.trim();
    if (!selection || !text) return;
    reset();
    onAsk(text, selection);
  };

  const dismiss = () => {
    reset();
    onDismiss();
  };

  const disabled = disabledReason !== null;

  return (
    <div
      ref={boxRef}
      className="fixed left-0 top-0 z-50 animate-rise"
      style={{ visibility: "hidden" }}
      onPointerDownCapture={take}
      onFocusCapture={take}
      /* Pressing a button must not collapse the selection it acts on. */
      onMouseDown={(event) => {
        if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
      }}
    >
      <Toolbar
        aria-label="Selected passage"
        className="flex items-center gap-0.5 rounded-lg bg-panel-raised p-1 shadow-float ring-1 ring-white/[0.06]"
      >
        {asking ? (
          <>
            <MessageCircleQuestion aria-hidden className="ml-1.5 size-3.5 shrink-0 text-dim" />
            <ToolbarInput
              autoFocus
              aria-label="Your question about this passage"
              placeholder="Ask about this passage…"
              value={question}
              maxLength={8000}
              onChange={(event) => setQuestion(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  dismiss();
                }
              }}
              onBlur={() => {
                /* Leaving the field closes it, unless the whole window lost focus or focus stayed in the toolbar. */
                setTimeout(() => {
                  if (!document.hasFocus() || boxRef.current?.contains(document.activeElement)) return;
                  if (askingRef.current) reset();
                }, 0);
              }}
              className="h-7 w-[min(320px,60vw)] bg-transparent px-1.5 text-[13px] text-paper outline-none placeholder:text-dim"
            />
            <ToolbarButton
              aria-label="Ask"
              title="Ask (Enter)"
              disabled={!question.trim() || disabled}
              onClick={submit}
              className={`${itemClass} w-7 justify-center px-0`}
            >
              <ArrowUp strokeWidth={2.25} />
            </ToolbarButton>
          </>
        ) : (
          <>
            <Action icon={<Sparkles />} label="Explain" title={disabledReason ?? undefined} disabled={disabled} onPress={() => act("explain")} />
            <Action icon={<Layers />} label="Go deeper" title={disabledReason ?? undefined} disabled={disabled} onPress={() => act("deeper")} />
            <Action
              icon={<MessageCircleQuestion />}
              label="Ask…"
              title={disabledReason ?? undefined}
              disabled={disabled}
              onPress={() => {
                if (!take()) return;
                askingRef.current = true;
                setAsking(true);
              }}
            />
            <ToolbarSeparator className="mx-1 h-4 w-px shrink-0 bg-line-strong" />
            <ToolbarGroup disabled aria-label="Coming soon" className="flex items-center gap-0.5">
              <ToolbarButton aria-label="Highlight (coming soon)" title="Highlight · coming soon" className={`${itemClass} w-7 justify-center px-0`}>
                <Highlighter />
              </ToolbarButton>
              <ToolbarButton aria-label="Note (coming soon)" title="Note · coming soon" className={`${itemClass} w-7 justify-center px-0`}>
                <NotebookPen />
              </ToolbarButton>
              <ToolbarButton aria-label="Card (coming soon)" title="Card · coming soon" className={`${itemClass} w-7 justify-center px-0`}>
                <BookOpenText />
              </ToolbarButton>
            </ToolbarGroup>
            <span aria-hidden className="pl-1 pr-1.5 text-[11px] text-dim">
              Soon
            </span>
          </>
        )}
      </Toolbar>
    </div>
  );
}
