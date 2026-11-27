"use client";

import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { X } from "lucide-react";
import clsx from "clsx";
import { isTextEntry } from "@/lib/client/keys";
import { IconButton } from ".";

/**
 * A modal `<dialog>` on the top layer from the moment it mounts. The browser traps focus in it and closes it
 * on Escape; a click on the backdrop closes it too, unless `lightDismiss` is off. Unmount it to take it away.
 */
export function ModalDialog({
  onClose,
  lightDismiss = true,
  ...props
}: Omit<ComponentProps<"dialog">, "ref" | "open" | "onClose" | "onClick"> & { onClose(): void; lightDismiss?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);

  /* No close() on cleanup: its close event would call onClose after a remount. Unmounting takes the dialog off the top layer anyway. */
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    /* Opening moves focus to the dialog's first control. A field that took focus as it mounted keeps it, and a
       dialog that can hold focus itself takes it, so a key meant for the dialog never presses a button. */
    const held = dialog.contains(document.activeElement) ? document.activeElement : null;
    dialog.showModal();
    if (held instanceof HTMLElement) held.focus();
    else if (dialog.hasAttribute("tabindex")) dialog.focus();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (lightDismiss && event.target === event.currentTarget) onClose();
      }}
      {...props}
    />
  );
}

/**
 * A short turn away from the book that ends back at the same place: a question to answer, cards to review, a
 * chapter's test. It sits over the book, which stays where it was behind it, and is as tall as what it holds, up to
 * most of the window. `veiled` blurs what is behind, for a turn that asks the reader to recall what the page says.
 * Escape, the close button and a click outside all end in `onClose`, which is where anything unfinished is saved.
 */
export function BookModal({
  label,
  heading,
  closeLabel,
  veiled = false,
  lightDismiss = true,
  typingKeepsEscape = false,
  onClose,
  children,
}: {
  label: string;
  heading: ReactNode;
  closeLabel: string;
  veiled?: boolean;
  /** Off for a turn a stray click would lose, such as a test part-way through. */
  lightDismiss?: boolean;
  /** Escape pressed in a text field is left to the field. */
  typingKeepsEscape?: boolean;
  onClose(): void;
  children: ReactNode;
}) {
  return (
    <ModalDialog
      aria-label={label}
      tabIndex={-1}
      lightDismiss={lightDismiss}
      onClose={onClose}
      onCancel={(event) => {
        if (typingKeepsEscape && isTextEntry(document.activeElement)) event.preventDefault();
      }}
      className={clsx(
        "mx-auto mt-[10vh] mb-auto flex max-h-[80vh] w-[min(680px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl bg-page p-0 text-paper shadow-dialog outline-none backdrop:bg-scrim",
        veiled && "backdrop:backdrop-blur-md",
      )}
    >
      <div className="flex h-11 shrink-0 items-center gap-3 pl-5 pr-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">{heading}</div>
        <IconButton label={closeLabel} onClick={onClose}>
          <X />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1 justify-center overflow-y-auto px-5 pb-6 pt-3">{children}</div>
    </ModalDialog>
  );
}
