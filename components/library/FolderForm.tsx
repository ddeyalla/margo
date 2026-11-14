"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui";
import { saveFolders } from "@/lib/client/api";

export interface FolderValue {
  path: string | null;
  fromEnv: boolean;
}

const noSubscription = () => () => undefined;
/** The Mac app offers a native folder picker; a browser does not. */
const useFolderPicker = () =>
  useSyncExternalStore(
    noSubscription,
    () => typeof window.riggApp?.pickFolder === "function",
    () => false,
  );

function FolderField({
  label,
  hint,
  value,
  fromEnv,
  hasPicker,
  placeholder,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  fromEnv: boolean;
  hasPicker: boolean;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const pick = async () => {
    const chosen = await window.riggApp?.pickFolder();
    if (chosen) onChange(chosen);
  };
  return (
    <div className="flex flex-col gap-1.5 text-left">
      <label className="text-label font-medium text-fog" htmlFor={`folder-${label}`}>
        {label}
      </label>
      {fromEnv ? (
        <>
          <p id={`folder-${label}`} className="break-all rounded-sm bg-panel px-2.5 py-1.5 text-label text-fog">
            {value}
          </p>
          <p className="text-label text-dim">Set in .env.local</p>
        </>
      ) : (
        <>
          <div className="flex gap-2">
            {hasPicker ? (
              <p id={`folder-${label}`} className="min-w-0 flex-1 truncate rounded-sm bg-panel px-2.5 py-1.5 text-label text-fog">
                {value || <span className="text-dim">{placeholder}</span>}
              </p>
            ) : (
              <input
                id={`folder-${label}`}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                spellCheck={false}
                autoComplete="off"
                className="h-8 min-w-0 flex-1 rounded-sm bg-panel px-2.5 text-label text-paper placeholder:text-dim focus:outline-1 focus:outline-fog/40"
              />
            )}
            {hasPicker ? <Button onClick={pick}>Choose folder…</Button> : null}
          </div>
          <p className="text-label text-dim">{hint}</p>
        </>
      )}
    </div>
  );
}

/** Asks for the books folder and, optionally, the notes folder, saves them and reloads the page. */
export function FolderForm({ books, notes, onDone }: { books: FolderValue; notes: FolderValue; onDone?: () => void }) {
  const router = useRouter();
  const hasPicker = useFolderPicker();
  const [booksPath, setBooksPath] = useState(books.path ?? "");
  const [notesPath, setNotesPath] = useState(notes.path ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const message = await saveFolders({
      ...(books.fromEnv ? {} : { booksDir: booksPath.trim() }),
      ...(notes.fromEnv ? {} : { notesDir: notesPath.trim() || null }),
    });
    setSaving(false);
    if (message) return setError(message);
    onDone?.();
    router.refresh();
  };

  return (
    <form
      className="flex w-full max-w-[460px] flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <FolderField
        label="Books folder"
        hint="EPUB and PDF files, in any subfolders. The app never changes them."
        value={books.fromEnv ? (books.path ?? "") : booksPath}
        fromEnv={books.fromEnv}
        hasPicker={hasPicker}
        placeholder="/Users/you/Books"
        onChange={setBooksPath}
      />
      <FolderField
        label="Notes folder (optional)"
        hint="A folder in your Obsidian vault gets a markdown copy of your highlights and notes."
        value={notes.fromEnv ? (notes.path ?? "") : notesPath}
        fromEnv={notes.fromEnv}
        hasPicker={hasPicker}
        placeholder="/Users/you/Obsidian/Reading"
        onChange={setNotesPath}
      />
      {error ? (
        <p role="alert" className="text-label text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={saving || (!books.fromEnv && !booksPath.trim())}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {onDone ? (
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
