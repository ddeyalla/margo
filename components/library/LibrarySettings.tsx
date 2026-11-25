"use client";

import { useEffect, useRef, useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui";
import { ThemeControl } from "@/components/ui/theme";
import { FolderForm, type FolderValue } from "./FolderForm";

/**
 * A "Settings" button for the library heading. It opens the app's colours and its folders in a panel that grows
 * from the button, and closes on Escape, a click outside, or once the folders are saved.
 */
export function LibrarySettings({ books, notes }: { books: FolderValue; notes: FolderValue }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Button onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog">
        <Settings2 />
        Settings
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-label="Settings"
          className="absolute right-0 top-full z-20 mt-2 flex w-[min(460px,calc(100vw-48px))] origin-top-right flex-col gap-4 rounded-xl bg-panel-raised p-4 shadow-dialog transition-[opacity,scale] duration-[var(--duration-enter)] ease-out starting:scale-[0.97] starting:opacity-0 motion-reduce:transition-none"
        >
          <div className="flex items-center justify-between gap-4">
            <span className="text-label font-medium text-fog">App colours</span>
            <ThemeControl />
          </div>
          <div className="h-px bg-line" />
          <FolderForm books={books} notes={notes} onDone={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
