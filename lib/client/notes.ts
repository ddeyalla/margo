import type { Embed, HighlightBlock, NoteSave, NotesIndex, OpenedNote } from "@/lib/shared/notes";

/* The browser's side of /api/notes. A refusal throws an Error carrying the server's message. */

const json = async <T>(response: Response): Promise<T> => {
  if (response.ok) return (await response.json()) as T;
  const { error } = (await response.json().catch(() => ({}))) as { error?: string };
  throw new Error(error ?? `The notes folder answered ${response.status}.`);
};

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

export const fetchNotesIndex = (): Promise<NotesIndex> => fetch("/api/notes").then((r) => json<NotesIndex>(r));

export const fetchNote = (path: string): Promise<OpenedNote | null> =>
  fetch(`/api/notes/file?${q({ path })}`).then((r) => (r.status === 404 ? null : json<OpenedNote>(r)));

/** The note's version when it is no longer `since`: a new hash, or null when the file was deleted. Undefined when unchanged. */
export const fetchNoteChange = async (path: string, since: string): Promise<string | null | undefined> => {
  const answer = await fetch(`/api/notes/file?${q({ path, since })}`).then((r) => json<{ unchanged: true } | { hash: string | null }>(r));
  return "unchanged" in answer ? undefined : answer.hash;
};

export const saveNoteFile = (path: string, text: string, baseHash: string, keepalive = false): Promise<NoteSave> =>
  fetch("/api/notes/file", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, text, baseHash }),
    keepalive,
  }).then((r) => json<NoteSave>(r));

export const createNoteFile = (name: string, folder = ""): Promise<string> =>
  fetch("/api/notes/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, folder }) })
    .then((r) => json<{ path: string }>(r))
    .then((answer) => answer.path);

export const fetchHighlightBlocks = (): Promise<HighlightBlock[]> =>
  fetch("/api/notes/highlights").then((r) => json<{ highlights: HighlightBlock[] }>(r).then((a) => a.highlights));

export const fetchEmbed = (target: string, subpath: string | null, from: string): Promise<Embed | null> =>
  fetch(`/api/notes/embed?${q({ target, subpath: subpath ?? "", from })}`).then((r) => (r.status === 404 ? null : json<Embed>(r)));

export const noteImageUrl = (target: string, from: string) => `/api/notes/images?${q({ target, from })}`;

/** Saves a pasted image beside the note at `from` and answers with the link to insert. */
export const uploadNoteImage = (file: File, from: string): Promise<string> =>
  fetch(`/api/notes/images?${q({ from })}`, { method: "POST", headers: { "Content-Type": file.type }, body: file })
    .then((r) => json<{ link: string }>(r))
    .then((answer) => answer.link);
