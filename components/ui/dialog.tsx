"use client";

import { useEffect, useRef, type ComponentProps } from "react";

/**
 * A modal `<dialog>` on the top layer from the moment it mounts. The browser traps focus in it and closes it
 * on Escape; a click on the backdrop closes it too. Unmount it to take it away.
 */
export function ModalDialog({ onClose, ...props }: Omit<ComponentProps<"dialog">, "ref" | "open" | "onClose" | "onClick"> & { onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);

  /* No close() on cleanup: its close event would call onClose after a remount. Unmounting takes the dialog off the top layer anyway. */
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      {...props}
    />
  );
}
