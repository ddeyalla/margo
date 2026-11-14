"use client";

import { useState } from "react";
import { FolderForm, type FolderValue } from "./FolderForm";

/** A small "Folders" button for the library heading. It opens the folder form beneath it. */
export function FoldersControl({ books, notes }: { books: FolderValue; notes: FolderValue }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="press ml-auto text-label text-dim underline-offset-2 transition-colors duration-[var(--duration-fast)] hover:text-paper hover:underline"
      >
        Folders
      </button>
      {open ? (
        <div className="basis-full pt-4">
          <FolderForm books={books} notes={notes} onDone={() => setOpen(false)} />
        </div>
      ) : null}
    </>
  );
}
