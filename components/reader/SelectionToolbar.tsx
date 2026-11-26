"use client";

import { useEffectEvent, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { ArrowUp, BookOpenText, ChevronLeft, CircleParking, Ellipsis, Highlighter, Layers, MessageCircleQuestion, NotebookPen } from "lucide-react";
import { Toolbar, ToolbarButton, ToolbarInput, ToolbarSeparator } from "@ui-sdk/react/toolbar";
import { DictationNote, MicButton } from "@/components/chat/MicButton";
import { useDictation } from "@/components/chat/useDictation";
import { useUnsentText } from "@/lib/client/unsent";
import { insertAtCaret } from "@/lib/shared/dictation";
import type { SelectionContext } from "@/lib/shared/types";
import { placeFloating } from "./floating";
import type { SelectionRect } from "./types";

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
  /** The tutor is answering; its actions wait, while highlighting, notes and parking stay open. */
  tutorBusy: boolean;
  /** The reader's question about the passage, or null when they sent the field empty: explain it. */
  onAsk(question: string | null, selection: SelectionContext): void;
  /** Opens the reader's turn on the passage, over the book. */
  onDeeper(selection: SelectionContext): void;
  /** Saves the reader's question on the passage without asking the tutor. */
  onPark(text: string, selection: SelectionContext): void;
  onHighlight(selection: SelectionContext): void;
  onNote(selection: SelectionContext): void;
  /** Asks the tutor for flashcards on the passage. */
  onCard(selection: SelectionContext): void;
  onDismiss(): void;
}

type InputKind = "ask" | "park";

const MAX_QUESTION = 8000;

const INPUTS = {
  ask: { icon: MessageCircleQuestion, label: "Your question about this passage. Leave it empty to have the passage explained.", placeholder: "Ask, or press Enter to have it explained…", button: "Ask" },
  park: { icon: CircleParking, label: "A question to park on this passage", placeholder: "Park a question for later…", button: "Park" },
} satisfies Record<InputKind, { icon: typeof CircleParking; label: string; placeholder: string; button: string }>;

const itemClass =
  "press inline-flex h-7 shrink-0 select-none items-center gap-1.5 rounded-sm px-2 text-label text-fog outline-none transition-[color,background-color,scale,opacity] duration-[var(--duration-fast)] ease-out hover:bg-tint hover:text-paper focus-visible:bg-tint focus-visible:text-paper data-[disabled]:opacity-40 data-[disabled]:hover:bg-transparent data-[disabled]:hover:text-fog [&>svg]:size-3.5 [&>svg]:shrink-0";

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
 * Ask, Go deeper and Highlight, with Note, Park a question and Make cards behind
 * More. Ask and Park swap the buttons for an inline text field; Ask sent empty
 * asks for the passage to be explained.
 */
export function SelectionToolbar({
  ref,
  bounds,
  readSelection,
  disabledReason,
  tutorBusy,
  onAsk,
  onDeeper,
  onPark,
  onHighlight,
  onNote,
  onCard,
  onDismiss,
}: SelectionToolbarProps) {
  /* The selection's latest rect lives in a ref; state changes only when the bar appears or goes. */
  const rectRef = useRef<SelectionRect | null>(null);
  const [shown, setShown] = useState(false);
  const shownRef = useRef(false);
  const show = (next: boolean) => {
    shownRef.current = next;
    setShown(next);
  };
  const [asking, setAsking] = useState<InputKind | null>(null);
  /* The second row of actions, behind More. */
  const [more, setMore] = useState(false);
  const [question, setQuestion] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  /* Read once the reader reaches for the toolbar, before focus can move and clear a PDF selection. */
  const snapshot = useRef<SelectionContext | null>(null);
  const askingRef = useRef(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  useUnsentText(question.trim().length > 0);
  const dictation = useDictation((words) => {
    const field = fieldRef.current;
    if (!field) return;
    const next = insertAtCaret(field.value, field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length, words, MAX_QUESTION);
    caret.current = next.caret;
    setQuestion(next.value);
  });

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field || caret.current === null) return;
    field.focus();
    field.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [question]);

  const reset = () => {
    dictation.cancel();
    askingRef.current = false;
    snapshot.current = null;
    setAsking(null);
    setMore(false);
    setQuestion("");
    rectRef.current = null;
    show(false);
  };

  /* Moves the bar to the selection; called straight from update, so following a selection while scrolling never re-renders. */
  const place = () => {
    const box = boxRef.current;
    const rect = rectRef.current;
    const area = rect && bounds();
    if (box && rect && area) placeFloating(box, rect, area);
  };

  useImperativeHandle(ref, () => ({
    update(next) {
      /* Focusing the question field clears a PDF selection; the snapshot holds it until the question is sent. */
      if (askingRef.current) return;
      if (!next) {
        snapshot.current = null;
        /* The next selection starts on the first row again. */
        setMore(false);
      }
      rectRef.current = next;
      if (shownRef.current !== !!next) show(!!next);
      else place();
    },
  }));

  const placeLater = useEffectEvent(place);

  /* Placed again whenever the bar changes size, such as a line under the question appearing, so it never covers the passage. */
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!shown || !box) return;
    placeLater();
    const observer = new ResizeObserver(() => placeLater());
    observer.observe(box);
    return () => observer.disconnect();
  }, [shown]);

  useLayoutEffect(() => {
    if (shown) placeLater();
  }, [shown, asking, more, bounds]);

  if (!shown) return null;

  const take = () => (snapshot.current ??= readSelection());
  const disabled = disabledReason !== null;
  const tutorOff = disabled || tutorBusy;

  /* Acts on the passage and closes the bar: Go deeper and Make cards, and Highlight and Note, which work without the tutor. */
  const keep = (save: (selection: SelectionContext) => void) => {
    const selection = take();
    if (!selection) return;
    reset();
    save(selection);
  };

  const submit = () => {
    const selection = snapshot.current;
    const text = question.trim();
    if (!selection || !asking) return;
    const kind = asking;
    /* A parked question needs its words; Ask sent empty means "explain this". */
    if (kind === "park" ? !text : tutorOff) return;
    reset();
    if (kind === "park") onPark(text, selection);
    else onAsk(text || null, selection);
  };

  const dismiss = () => {
    reset();
    onDismiss();
  };

  const tutorTitle = disabledReason ?? (tutorBusy ? "The tutor is still answering." : undefined);
  /* Parking never calls the tutor, so it works when the tutor is unavailable or busy. */
  const inputDisabled = tutorOff && asking !== "park";
  const input = INPUTS[asking ?? "ask"];
  const open = (kind: InputKind) => {
    if (!take()) return;
    askingRef.current = true;
    setAsking(kind);
  };

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
        className="flex flex-wrap items-center gap-0.5 rounded-lg bg-panel-raised p-1 shadow-float"
      >
        {asking ? (
          <>
            <input.icon aria-hidden className="ml-1.5 size-3.5 shrink-0 text-dim" />
            <ToolbarInput
              ref={fieldRef}
              autoFocus
              aria-label={input.label}
              placeholder={input.placeholder}
              value={question}
              maxLength={MAX_QUESTION}
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
              className="h-7 w-[min(320px,60vw)] bg-transparent px-1.5 text-body text-paper outline-none placeholder:text-dim"
            />
            <MicButton dictation={dictation} disabled={inputDisabled} className="h-6 min-w-6" />
            <ToolbarButton
              aria-label={input.button}
              title={`${input.button} (Enter)`}
              disabled={asking === "park" ? !question.trim() : inputDisabled}
              onClick={submit}
              className={`${itemClass} w-7 justify-center px-0`}
            >
              <ArrowUp strokeWidth={2.25} />
            </ToolbarButton>
            <DictationNote dictation={dictation} className="basis-full max-w-[min(420px,80vw)] px-1.5 pb-1" />
          </>
        ) : more ? (
          <>
            <ToolbarButton aria-label="Back" title="Back" onClick={() => setMore(false)} className={`${itemClass} w-7 justify-center px-0`}>
              <ChevronLeft />
            </ToolbarButton>
            <Action icon={<NotebookPen />} label="Note" title="Write a note on this passage" disabled={false} onPress={() => keep(onNote)} />
            <Action icon={<CircleParking />} label="Park" title="Park a question for later. It isn't sent to the tutor." disabled={false} onPress={() => open("park")} />
            <Action icon={<BookOpenText />} label="Make cards" title={disabledReason ?? "Make flashcards from this passage"} disabled={disabled} onPress={() => keep(onCard)} />
          </>
        ) : (
          <>
            <Action icon={<MessageCircleQuestion />} label="Ask" title={tutorTitle ?? "Ask a question, or press Enter to have the passage explained"} disabled={tutorOff} onPress={() => open("ask")} />
            <Action icon={<Layers />} label="Go deeper" title={tutorTitle ?? "Answer first, then see how you did"} disabled={tutorOff} onPress={() => keep(onDeeper)} />
            <ToolbarSeparator className="mx-1 h-4 w-px shrink-0 bg-line-strong" />
            <ToolbarButton
              aria-label="Highlight"
              title="Highlight (⌘⇧H)"
              onClick={() => keep(onHighlight)}
              className={`${itemClass} w-7 justify-center px-0`}
            >
              <Highlighter />
            </ToolbarButton>
            <ToolbarButton
              aria-label="More: note, park a question, make cards"
              aria-expanded={false}
              title="More"
              onClick={() => {
                if (take()) setMore(true);
              }}
              className={`${itemClass} w-7 justify-center px-0`}
            >
              <Ellipsis />
            </ToolbarButton>
          </>
        )}
      </Toolbar>
    </div>
  );
}
