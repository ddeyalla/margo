"use client";

import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui";
import { FolderForm, type FolderValue } from "./FolderForm";

/** A small "Folders" button for the library heading. It opens the folder form beneath it. */
export function FoldersControl({ books, notes }: { books: FolderValue; notes: FolderValue }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <FolderOpen />
        Folders
      </Button>
      {open ? (
        <div className="basis-full pt-4">
          <FolderForm books={books} notes={notes} onDone={() => setOpen(false)} />
        </div>
      ) : null}
    </>
  );
}
