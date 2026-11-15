"use client";

import { useEffect, useState } from "react";
import { CircleAlert, X } from "lucide-react";
import { IconButton } from "@/components/ui";

/** How long a toast stays. */
const TOAST_MS = 4000;

/** A problem saving a highlight or note, over the top of the book until dismissed. */
export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss(): void }) {
  return (
    <div
      role="alert"
      className="animate-rise absolute left-1/2 top-3 z-20 flex w-max max-w-[min(520px,calc(100%-24px))] -translate-x-1/2 items-start gap-2 rounded-lg bg-panel-raised py-2 pl-3 pr-1.5 text-label text-fog shadow-float"
    >
      <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warn" />
      <p className="min-w-0 py-px leading-relaxed [overflow-wrap:anywhere]">{message}</p>
      <IconButton label="Dismiss" size="sm" onClick={onDismiss}>
        <X />
      </IconButton>
    </div>
  );
}

export interface ToastMessage {
  text: string;
  /** Whether to offer "Show". */
  action: boolean;
}

/** A small confirmation, such as after parking a question, that goes by itself. */
export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  return [toast, setToast] as const;
}

/** A toast near the bottom of the book. Unlike the banner it is polite, passing, and offers a way to what it confirms. */
export function Toast({ toast, onShow }: { toast: ToastMessage; onShow(): void }) {
  return (
    <div
      role="status"
      className="animate-rise absolute bottom-14 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full bg-panel-raised py-0.5 pl-3.5 pr-1 text-label text-fog shadow-float"
    >
      <span className="py-1">{toast.text}</span>
      {toast.action ? (
        <button
          type="button"
          onClick={onShow}
          className="press h-6 rounded-full px-2 text-label font-medium text-paper transition-colors duration-[var(--duration-fast)] hover:bg-tint-strong"
        >
          Show
        </button>
      ) : null}
    </div>
  );
}
