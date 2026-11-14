"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { NotebookPen, Trash2 } from "lucide-react";
import { Toolbar, ToolbarButton } from "@ui-sdk/react/toolbar";
import { placeFloating } from "@/components/reader/floating";
import type { SelectionRect } from "@/components/reader/types";

const itemClass =
  "press inline-flex h-7 shrink-0 select-none items-center gap-1.5 rounded-sm px-2 text-label text-fog outline-none transition-[color,background-color,scale] duration-[var(--duration-fast)] ease-out hover:bg-tint hover:text-paper focus-visible:bg-tint focus-visible:text-paper [&>svg]:size-3.5 [&>svg]:shrink-0";

/** Floats over a highlight the reader clicked: open its note, or remove the highlight. */
export function HighlightMenu({
  rect,
  bounds,
  hasNote,
  onNote,
  onRemove,
  onClose,
}: {
  rect: SelectionRect;
  bounds(): DOMRect | null;
  hasNote: boolean;
  onNote(): void;
  onRemove(): void;
  onClose(): void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const area = bounds();
    if (box && area) placeFloating(box, rect, area);
  }, [rect, bounds]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div ref={boxRef} className="fixed left-0 top-0 z-50 animate-rise" style={{ visibility: "hidden" }}>
      <Toolbar aria-label="Highlight" className="flex items-center gap-0.5 rounded-lg bg-panel-raised p-1 shadow-float">
        {hasNote ? (
          <ToolbarButton className={itemClass} onClick={onNote}>
            <NotebookPen />
            Note
          </ToolbarButton>
        ) : null}
        <ToolbarButton className={itemClass} onClick={onRemove}>
          <Trash2 />
          Remove
        </ToolbarButton>
      </Toolbar>
    </div>
  );
}
