"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, type ReactNode } from "react";
import { Button, Field } from "@/components/ui";
import { ModalDialog } from "@/components/ui/dialog";
import { forgetBook, relinkBook } from "@/lib/client/api";
import { rankCandidates, type RelinkCandidate } from "@/lib/shared/relink";
import type { MissingBook, SavedSummary } from "@/lib/shared/types";

const counted = (count: number, one: string, many = `${one}s`) => (count ? [`${count} ${count === 1 ? one : many}`] : []);

const savedParts = (saved: SavedSummary) => [
  ...counted(saved.highlights, "highlight"),
  ...counted(saved.notes, "note"),
  ...counted(saved.cardSets, "card set"),
  ...counted(saved.threads, "chat"),
];

/** "12 highlights · 3 chats", or the reading place alone when that is all there is. */
const savedLine = (saved: SavedSummary | null) => {
  if (!saved) return "Saved data that can't be read";
  const parts = savedParts(saved);
  if (parts.length) return parts.join(" · ");
  return saved.hasPosition ? "Reading place" : "No highlights, notes or chats";
};

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** A centred, titled modal. */
function Modal({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const titleId = useId();
  return (
    <ModalDialog
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[min(520px,calc(100vw-32px))] rounded-xl bg-panel-raised p-0 text-paper shadow-dialog outline-none backdrop:bg-scrim"
    >
      <div className="flex flex-col gap-4 p-5">
        <h2 id={titleId} className="text-title text-paper">
          {title}
        </h2>
        {children}
      </div>
    </ModalDialog>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-label text-danger">
      {error}
    </p>
  ) : null;
}

/** Waits on a change the server may refuse; on success it closes and reloads the library. */
function useChange(onDone: () => void) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (change: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    const message = await change();
    setBusy(false);
    if (message) return setError(message);
    onDone();
    router.refresh();
  };
  return { busy, error, run };
}

function RelinkDialog({ book, candidates, onClose }: { book: MissingBook; candidates: RelinkCandidate[]; onClose(): void }) {
  const ranked = useMemo(() => rankCandidates(book, candidates), [book, candidates]);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<RelinkCandidate["id"] | null>(null);
  const { busy, error, run } = useChange(onClose);
  const filterId = useId();
  const name = useId();

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? ranked.filter((candidate) => `${candidate.title} ${candidate.relPath}`.toLowerCase().includes(needle))
    : ranked;
  /* A choice the filter hides is no choice, so Relink can only send a book the reader can see. */
  const picked = shown.some((candidate) => candidate.id === chosen) ? chosen : null;
  const kind = book.format === "epub" ? "EPUB" : book.format === "pdf" ? "PDF" : null;

  return (
    <Modal title={`Find the file for “${book.title}”`} onClose={onClose}>
      {ranked.length === 0 ? (
        <>
          <p className="text-body text-fog">
            {kind
              ? `Every ${kind} in the books folder already has saved data of its own, so none can take this one’s place.`
              : "Every book in the books folder already has saved data of its own, so none can take this one’s place."}{" "}
            Put the file back in the books folder, then reload.
          </p>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onClose} autoFocus>
              Close
            </Button>
          </div>
        </>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (picked) void run(() => relinkBook(book.id, picked));
          }}
        >
          <p className="text-label text-dim">
            {kind ? `Only ${kind}s` : "Only books"} with nothing saved of their own are listed. Likely matches come first.
            {book.relPath ? ` It was last at ${book.relPath}.` : ""}
          </p>
          <label htmlFor={filterId} className="sr-only">
            Filter books
          </label>
          <Field
            id={filterId}
            size="md"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by title or path"
            spellCheck={false}
            autoComplete="off"
          />
          <fieldset className="-mx-1 max-h-[min(360px,50dvh)] overflow-y-auto">
            <legend className="sr-only">Books in the books folder</legend>
            {shown.length === 0 ? <p className="px-1 py-3 text-label text-dim">No book matches “{query.trim()}”.</p> : null}
            {shown.map((candidate) => (
              <label
                key={candidate.id}
                className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 transition-colors duration-[var(--duration-fast)] hover:bg-tint has-[:checked]:bg-tint-strong has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-accent"
              >
                <input
                  type="radio"
                  name={name}
                  value={candidate.id}
                  checked={picked === candidate.id}
                  onChange={() => setChosen(candidate.id)}
                  className="mt-0.5 accent-[var(--color-paper)] outline-none"
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-body font-medium text-paper">{candidate.title}</span>
                  <span className="truncate text-label text-dim">
                    {candidate.relPath} · {candidate.format === "epub" ? "EPUB" : "PDF"} · {formatSize(candidate.sizeBytes)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <ErrorLine error={error} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!picked || busy}>
              {busy ? "Relinking…" : "Relink"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ForgetDialog({ book, onClose }: { book: MissingBook; onClose(): void }) {
  const { busy, error, run } = useChange(onClose);
  const moved = [
    ...(book.saved ? savedParts(book.saved) : ["its saved highlights, notes, cards and chats"]),
    ...(book.saved?.hasPosition ? ["the reading place"] : []),
    "its title and other saved details",
    "its cover and any images sent in its chats",
  ];
  return (
    <Modal title={`Forget “${book.title}”?`} onClose={onClose}>
      <div className="flex flex-col gap-2 text-body text-fog">
        <p>This takes the book off the list and moves what the app keeps for it out of the way:</p>
        <ul className="list-disc pl-5">
          {moved.map((part) => (
            <li key={part}>{part}</li>
          ))}
        </ul>
        <p>
          It all goes to the “forgotten” folder inside the data folder, where you can move it back by hand. Notes already written to your
          notes folder stay where they are.
        </p>
      </div>
      <ErrorLine error={error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} autoFocus>
          Cancel
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => void run(() => forgetBook(book.id))}>
          {busy ? "Forgetting…" : "Forget"}
        </Button>
      </div>
    </Modal>
  );
}

type Open = { kind: "relink" | "forget"; book: MissingBook } | null;

/** Books with saved data whose files the library no longer finds, each with a way to relink it to a file or forget it. */
export function MissingBooks({ books, candidates }: { books: MissingBook[]; candidates: RelinkCandidate[] }) {
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  return (
    <section aria-labelledby="missing-books" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="missing-books" className="flex items-baseline gap-2 text-section text-fog">
          Missing books
          <span className="text-label font-normal text-dim tabular-nums">({books.length})</span>
        </h2>
        <p className="text-label text-dim">Saved reading for files that are no longer in the books folder.</p>
      </div>
      <ul className="flex flex-col rounded-xl bg-panel shadow-canvas">
        {books.map((book) => (
          <li key={book.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-line px-4 py-3 [&:not(:first-child)]:border-t">
            <div className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
              <p className="truncate text-body font-semibold text-paper">{book.title}</p>
              <p className="truncate text-label text-dim">
                {savedLine(book.saved)}
                {book.relPath ? ` · was ${book.relPath}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button onClick={() => setOpen({ kind: "relink", book })}>Find file…</Button>
              <Button variant="ghost" onClick={() => setOpen({ kind: "forget", book })}>
                Forget
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {open?.kind === "relink" ? <RelinkDialog key={open.book.id} book={open.book} candidates={candidates} onClose={close} /> : null}
      {open?.kind === "forget" ? <ForgetDialog key={open.book.id} book={open.book} onClose={close} /> : null}
    </section>
  );
}
