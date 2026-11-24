"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ArrowLeft, FileText, Link2, NotebookPen, Plus, TriangleAlert } from "lucide-react";
import { Button, EmptyState, IconButton, Spinner } from "@/components/ui";
import { ThemeControl } from "@/components/ui/theme";
import {
  createNoteFile,
  fetchEmbed,
  fetchHighlightBlocks,
  fetchNote,
  fetchNoteChange,
  fetchNotesIndex,
  noteImageUrl,
  saveNoteFile,
  uploadNoteImage,
} from "@/lib/client/notes";
import type { Backlink, HighlightBlock, NotesIndex, OpenedNote } from "@/lib/shared/notes";
import { NOTE_MAX_CHARS } from "@/lib/shared/notes";
import { noteTitle, resolveWikiLink } from "@/lib/shared/wikilinks";
import type { EditorHost } from "./editor/host";
import { MarkdownEditor, type MarkdownEditorHandle } from "./editor/MarkdownEditor";
import { clearEmbedCache } from "./editor/widgets";
import { NoteSession, type SaveStatus } from "./noteSession";

/** How often an open note looks for a change made in another app while the window is in front. */
const DISK_CHECK_MS = 2500;

const api = { save: saveNoteFile, change: fetchNoteChange, open: fetchNote };

type Notice = { kind: "conflict"; copy: string; deleted: boolean } | { kind: "gone" } | { kind: "error"; message: string };

const urlFor = (path: string | null) => (path ? `/notes?${new URLSearchParams({ path })}` : "/notes");

const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(iso));
};

/** The notes page: the notes folder's notes on the left, the open one in a live-preview editor, and what links to it. */
export function NotesWorkspace({ initialIndex, initialPath, notesDir }: { initialIndex: NotesIndex; initialPath: string | null; notesDir: string }) {
  const router = useRouter();
  const [index, setIndex] = useState(initialIndex);
  const [note, setNote] = useState<OpenedNote | null>(null);
  /* A new number remounts the editor, for a note opened rather than a version of the same note. */
  const [editorKey, setEditorKey] = useState(0);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const sessionRef = useRef<NoteSession | null>(null);
  const openTurn = useRef(0);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const indexRef = useRef(index);
  const highlightsRef = useRef<Promise<HighlightBlock[]> | null>(null);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  const refreshIndex = useCallback(async () => {
    const next = await fetchNotesIndex().catch(() => null);
    if (next) setIndex(next);
    highlightsRef.current = null;
    return next;
  }, []);

  /** Leaves the open note, saving what is unsaved first, and opens `path` (or nothing). */
  const open = useCallback(
    async (path: string | null, history: "push" | "replace" | "none" = "push") => {
      /* Only the latest request opens its note, however the earlier ones' saves and reads finish. */
      const turn = ++openTurn.current;
      const previous = sessionRef.current;
      if (previous) {
        sessionRef.current = null;
        await previous.flush();
        previous.close();
      }
      if (turn !== openTurn.current) return;
      setNotice(null);
      if (history === "push") window.history.pushState(null, "", urlFor(path));
      else if (history === "replace") window.history.replaceState(null, "", urlFor(path));
      if (!path) {
        setNote(null);
        return;
      }
      setLoading(true);
      let opened: OpenedNote | null = null;
      let failure: Notice = { kind: "gone" };
      try {
        opened = await fetchNote(path);
      } catch (error) {
        failure = { kind: "error", message: error instanceof Error ? error.message : String(error) };
      }
      if (turn !== openTurn.current) return;
      setLoading(false);
      if (!opened) {
        setNote(null);
        setNotice(failure);
        return;
      }
      clearEmbedCache();
      const session = new NoteSession(opened.path, opened, api, {
        replace: (text) => editorRef.current?.setText(text),
        status: (next, error) => {
          setStatus(next);
          if (next === "error" && error) setNotice({ kind: "error", message: error });
        },
        conflict: (copy, deleted) => {
          setNotice({ kind: "conflict", copy, deleted });
          void refreshIndex();
        },
        gone: () => {
          setNotice({ kind: "gone" });
          void refreshIndex();
        },
        reopened: (fresh) => setNote((current) => (current?.path === fresh.path ? { ...fresh } : current)),
      });
      sessionRef.current = session;
      setStatus("saved");
      setNote(opened);
      setEditorKey((key) => key + 1);
    },
    [refreshIndex],
  );

  /* Opens the note named in the address, and follows the browser's back and forward buttons. */
  const opening = useRef(initialPath);
  useEffect(() => {
    if (opening.current) void open(opening.current, "none");
    opening.current = null;
    const onPop = () => void open(new URLSearchParams(window.location.search).get("path"), "none");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open]);

  /* Picks up edits made in Obsidian: on returning to the window, and every few seconds while it is in front. */
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === "visible") void sessionRef.current?.checkDisk();
    };
    const timer = window.setInterval(check, DISK_CHECK_MS);
    const onFocus = () => {
      check();
      void refreshIndex();
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") void sessionRef.current?.flush();
    };
    /* A last save as the page goes; the server still keeps both versions if the file changed. */
    const onUnload = () => {
      const session = sessionRef.current;
      const pending = session?.unsaved();
      if (session && pending) void saveNoteFile(session.path, pending.text, pending.baseHash, true).catch(() => undefined);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onUnload);
    };
  }, [refreshIndex]);

  const allPaths = useCallback(() => [...indexRef.current.notes, ...indexRef.current.books].map((n) => n.path), []);

  /** Opens what a [[link]] names: a note, a book's file (the book itself), or a new note when nothing has the name. */
  const openLink = useCallback(
    async (target: string, fromPath: string) => {
      const path = resolveWikiLink(target, fromPath, allPaths());
      const book = indexRef.current.books.find((b) => b.path === path);
      if (book) return router.push(`/book/${book.bookId}`);
      if (path) return void open(path);
      const slash = target.lastIndexOf("/");
      try {
        const created = await createNoteFile(target.slice(slash + 1), slash === -1 ? "" : target.slice(0, slash));
        await refreshIndex();
        await open(created);
      } catch (error) {
        setNotice({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
    },
    [allPaths, open, refreshIndex, router],
  );

  const host = useMemo<EditorHost>(() => {
    const from = note?.path ?? "";
    return {
      notePath: from,
      index: () => indexRef.current,
      highlights: () => (highlightsRef.current ??= fetchHighlightBlocks().catch(() => [])),
      openLink: (target) => void openLink(target, from),
      linkExists: (target) => resolveWikiLink(target, from, allPaths()) !== null,
      imageUrl: (target) => noteImageUrl(target, from),
      embed: (target, subpath) => fetchEmbed(target, subpath, from),
      saveImage: async (file) => {
        try {
          return await uploadNoteImage(file, from);
        } catch (error) {
          setNotice({ kind: "error", message: error instanceof Error ? error.message : String(error) });
          return null;
        }
      },
      openBook: (bookId) => router.push(`/book/${bookId}`),
    };
  }, [note?.path, openLink, allPaths, router]);

  const newNote = async () => {
    try {
      const created = await createNoteFile("Untitled");
      await refreshIndex();
      await open(created);
      editorRef.current?.focus();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const shown = useMemo(() => {
    const words = filter.toLowerCase().trim();
    return words ? index.notes.filter((n) => n.path.toLowerCase().includes(words)) : index.notes;
  }, [index.notes, filter]);

  return (
    <div className="flex h-dvh min-h-0 bg-ink text-paper">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex h-12 shrink-0 items-center gap-1.5 px-2">
          <Link href="/" aria-label="Back to the library" title="Back to the library" className="inline-flex size-7 items-center justify-center rounded-sm text-dim hover:bg-tint hover:text-paper">
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="flex-1 text-[13px] font-semibold">Notes</h1>
          <IconButton label="New note" onClick={() => void newNote()}>
            <Plus />
          </IconButton>
        </div>
        <div className="px-2 pb-2">
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value)}
            placeholder="Filter notes"
            aria-label="Filter notes"
            className="h-7 w-full rounded-sm bg-ink/60 px-2.5 text-label text-paper outline-none ring-1 ring-line placeholder:text-dim focus:ring-line-strong"
          />
        </div>
        <nav aria-label="Notes" className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
          {shown.length ? (
            <ul className="flex flex-col gap-px">
              {shown.map((item) => {
                const folder = item.path.includes("/") ? item.path.replace(/\/[^/]+$/, "") : null;
                return (
                  <li key={item.path}>
                    <button
                      type="button"
                      onClick={() => void open(item.path)}
                      aria-current={item.path === note?.path ? "page" : undefined}
                      className={clsx(
                        "flex w-full items-baseline gap-2 rounded-sm px-2 py-1.5 text-left text-label transition-colors duration-[var(--duration-fast)]",
                        item.path === note?.path ? "bg-tint-strong text-paper" : "text-fog hover:bg-tint hover:text-paper",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {item.title}
                        {folder ? <span className="ml-1.5 text-[11px] text-dim">{folder}</span> : null}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-dim">{ago(item.modifiedAt)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-2 py-3 text-label text-dim">{filter ? "No notes match." : "No notes yet."}</p>
          )}
        </nav>
        <p className="truncate border-t border-line px-3 py-2 text-[11px] text-dim" title={notesDir}>
          {notesDir}
        </p>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 px-4">
          <p className="min-w-0 flex-1 truncate text-label text-dim">{note ? note.path.replace(/\.md$/, "") : null}</p>
          {note ? <SaveState status={status} /> : null}
          <ThemeControl />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[740px] px-8 pb-10">
            {notice ? <NoticeBar notice={notice} onOpen={(path) => void open(path)} onDismiss={() => setNotice(null)} /> : null}
            {note ? (
              <>
                <h2 className="mb-3 mt-6 text-[28px] font-bold leading-tight text-paper">{noteTitle(note.path)}</h2>
                <MarkdownEditor
                  key={editorKey}
                  handle={editorRef}
                  initialText={note.text}
                  onChange={(text) => sessionRef.current?.edit(text)}
                  host={host}
                  label={`Note: ${noteTitle(note.path)}`}
                  placeholder="Write… / for commands, [[ to link a note, # for tags."
                  maxLength={NOTE_MAX_CHARS}
                  autoFocus
                />
                <Backlinks links={note.backlinks} onOpen={(path) => void open(path)} />
              </>
            ) : loading ? (
              <div className="flex justify-center pt-24 text-dim">
                <Spinner />
              </div>
            ) : (
              <div className="pt-24">
                <EmptyState icon={<NotebookPen />} title={index.notes.length ? "Pick a note" : "No notes yet"} body="Notes are Markdown files in your notes folder. Obsidian sees the same files.">
                  <Button className="mt-3" onClick={() => void newNote()}>
                    <Plus />
                    New note
                  </Button>
                </EmptyState>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function SaveState({ status }: { status: SaveStatus }) {
  const text = { saved: "Saved", unsaved: "Edited", saving: "Saving…", error: "Not saved" }[status];
  return <span className={clsx("shrink-0 text-[11px]", status === "error" ? "text-danger" : "text-dim")}>{text}</span>;
}

function NoticeBar({ notice, onOpen, onDismiss }: { notice: Notice; onOpen(path: string): void; onDismiss(): void }) {
  let body: React.ReactNode;
  if (notice.kind === "conflict") {
    const copy = (
      <button type="button" className="underline decoration-dim underline-offset-2 hover:decoration-paper" onClick={() => onOpen(notice.copy)}>
        {noteTitle(notice.copy)}
      </button>
    );
    body = notice.deleted ? (
      <>This note was deleted in another app while you were writing. Your text is kept in {copy}.</>
    ) : (
      <>This note changed in another app while you were writing, so it now shows that version. Your text is kept in {copy}.</>
    );
  } else if (notice.kind === "gone") {
    body = <>This note is no longer in the notes folder. It was moved or deleted in another app.</>;
  } else {
    body = notice.message;
  }
  return (
    <div role="status" className="mt-4 flex items-start gap-2.5 rounded-md bg-panel-raised px-3 py-2.5 text-label text-fog shadow-chip">
      <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-highlight-strong" />
      <p className="min-w-0 flex-1">{body}</p>
      <button type="button" onClick={onDismiss} className="shrink-0 text-dim hover:text-paper">
        Dismiss
      </button>
    </div>
  );
}

function Backlinks({ links, onOpen }: { links: Backlink[]; onOpen(path: string): void }) {
  return (
    <section aria-label="Linked from" className="mt-10 border-t border-line pt-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-dim">
        <Link2 aria-hidden className="size-3.5" />
        Linked from {links.length ? links.length : ""}
      </h3>
      {links.length ? (
        <ul className="flex flex-col gap-1">
          {links.map((link) => (
            <li key={link.path}>
              <button type="button" onClick={() => onOpen(link.path)} className="w-full rounded-sm px-2 py-1.5 text-left hover:bg-tint">
                <span className="flex items-center gap-1.5 text-label text-paper">
                  <FileText aria-hidden className="size-3.5 text-dim" />
                  {link.title}
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-dim">{link.context}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-2 text-label text-dim">No other note links here yet.</p>
      )}
    </section>
  );
}
