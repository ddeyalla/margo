"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button, Field } from "@/components/ui";
import { saveFolders } from "@/lib/client/api";

export interface FolderValue {
  path: string | null;
  fromEnv: boolean;
}

type FolderKind = "books" | "notes";

/**
 * Opens the Mac's folder dialog: the Mac app's own, or in a browser one the server opens, since a page can't learn
 * a folder's full path. Resolves to the path, null when cancelled, or "unsupported" when the server isn't a Mac.
 */
const pickFolder = async (kind: FolderKind): Promise<string | null | "unsupported"> => {
  if (window.riggApp?.pickFolder) return window.riggApp.pickFolder();
  const response = await fetch("/api/folder-picker", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind }),
  });
  if (response.status === 501) return "unsupported";
  const body = (await response.json().catch(() => null)) as { path?: string | null; error?: string } | null;
  if (!response.ok) throw new Error(body?.error ?? "The folder dialog could not open.");
  return body?.path ?? null;
};

function FolderField({
  label,
  kind,
  hint,
  value,
  fromEnv,
  hasPicker,
  placeholder,
  optional = false,
  onChange,
  onNoPicker,
  onError,
}: {
  label: string;
  kind: FolderKind;
  hint: string;
  value: string;
  fromEnv: boolean;
  hasPicker: boolean;
  placeholder: string;
  /** The folder may be left unset, so a chosen one can be cleared. */
  optional?: boolean;
  onChange: (value: string) => void;
  /** The server can't open a folder dialog, so paths are typed instead. */
  onNoPicker(): void;
  onError(message: string): void;
}) {
  const inputId = useId();
  const [picking, setPicking] = useState(false);
  const pick = async () => {
    setPicking(true);
    try {
      const chosen = await pickFolder(kind);
      if (chosen === "unsupported") onNoPicker();
      else if (chosen) onChange(chosen);
    } catch (error) {
      onError(error instanceof Error ? error.message : "The folder dialog could not open.");
    } finally {
      setPicking(false);
    }
  };
  /* Only a typed path is a form control; a set or picked path is just shown. */
  const typed = !fromEnv && !hasPicker;
  const labelClass = "text-label font-medium text-fog";
  return (
    <div className="flex flex-col gap-1.5 text-left">
      {typed ? (
        <label className={labelClass} htmlFor={inputId}>
          {label}
        </label>
      ) : (
        <p className={labelClass}>{label}</p>
      )}
      {fromEnv ? (
        <>
          <p className="break-all rounded-sm bg-panel px-2.5 py-1.5 text-label text-fog">
            {value}
          </p>
          <p className="text-label text-dim">Set in .env.local</p>
        </>
      ) : (
        <>
          <div className="flex gap-2">
            {hasPicker ? (
              <p className="min-w-0 flex-1 truncate rounded-sm bg-panel px-2.5 py-1.5 text-label text-fog ring-1 ring-inset ring-line">
                {value || <span className="text-dim">{placeholder}</span>}
              </p>
            ) : (
              <Field
                id={inputId}
                size="md"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                spellCheck={false}
                autoComplete="off"
                className="flex-1"
              />
            )}
            {hasPicker ? (
              <Button onClick={() => void pick()} disabled={picking}>
                {picking ? "Choosing…" : "Choose folder…"}
              </Button>
            ) : null}
            {hasPicker && optional && value ? (
              <Button variant="ghost" onClick={() => onChange("")}>
                Clear
              </Button>
            ) : null}
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
  /* Every Mac can show the folder dialog; typing a path is only for a server that can't. */
  const [hasPicker, setHasPicker] = useState(true);
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
        kind="books"
        onNoPicker={() => setHasPicker(false)}
        onError={setError}
        hint="EPUB and PDF files, in any subfolders. The app never changes them."
        value={books.fromEnv ? (books.path ?? "") : booksPath}
        fromEnv={books.fromEnv}
        hasPicker={hasPicker}
        placeholder="/Users/you/Books"
        onChange={setBooksPath}
      />
      <FolderField
        label="Notes folder (optional)"
        kind="notes"
        optional
        onNoPicker={() => setHasPicker(false)}
        onError={setError}
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
