import { Suspense } from "react";
import { stat } from "node:fs/promises";
import Link from "next/link";
import { connection } from "next/server";
import { FolderX } from "lucide-react";
import { NotesWorkspace } from "@/components/notes/NotesWorkspace";
import { EmptyState } from "@/components/ui";
import { getFolders } from "@/lib/server/config";
import { listNotes } from "@/lib/server/notes";

/* The open note is read from ?path= in the browser, so following links doesn't reload the page. */
export default function NotesPage() {
  return (
    <Suspense fallback={<div className="h-dvh bg-ink" />}>
      <Notes />
    </Suspense>
  );
}

async function Notes() {
  await connection();
  const notesDir = getFolders().notes.path;
  const there = notesDir ? (await stat(notesDir).catch(() => null))?.isDirectory() : false;
  if (!notesDir || !there) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink px-6">
        <EmptyState
          icon={<FolderX />}
          title={notesDir ? "The notes folder is not there" : "Choose a notes folder first"}
          body={
            notesDir
              ? `"${notesDir}" could not be found. Choose it again under Folders in the library.`
              : "Your notes are Markdown files in a folder of your own, such as an Obsidian vault. Choose it under Folders in the library."
          }
        >
          <Link href="/" className="mt-3 text-label text-paper underline decoration-dim underline-offset-2">
            Back to the library
          </Link>
        </EmptyState>
      </div>
    );
  }
  return <NotesWorkspace initialIndex={await listNotes(notesDir)} notesDir={notesDir} />;
}
