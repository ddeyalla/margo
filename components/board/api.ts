import type { Board, BoardAnswer, BoardSave, BoardSummary, CompactScene, OpenedBoard } from "@/lib/shared/boards";
import type { BookId, ProviderId } from "@/lib/shared/types";

const url = (bookId: BookId) => `/api/books/${bookId}/boards`;

const answer = async <T>(response: Response, doing: string): Promise<T> => {
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error ?? `${doing} failed (${response.status}).`);
  return body;
};

const post = (bookId: BookId, body: unknown, signal?: AbortSignal) =>
  fetch(url(bookId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });

/*
 * The save of each board still on its way. A board closed in one place and opened in another (the panel and the full
 * view) is read only once its last save has landed, so the new editor starts from the file's newest version.
 */
const landing = new Map<string, Promise<unknown>>();

/** Holds back the next opening of a board until `work`, such as a closing editor's last save, is done. */
export const settling = (id: string, work: Promise<unknown>) => {
  landing.set(id, work);
  void work.catch(() => undefined).finally(() => landing.get(id) === work && landing.delete(id));
};

export const fetchBoard = async (bookId: BookId, id: string): Promise<OpenedBoard> => {
  await landing.get(id)?.catch(() => undefined);
  return answer<OpenedBoard>(await fetch(`${url(bookId)}?id=${encodeURIComponent(id)}`, { cache: "no-store" }), "Opening the board");
};

/* Browsers refuse a keepalive request over 64 KB; a bigger board is sent plainly and may not outlive the page. */
const KEEPALIVE_LIMIT = 60_000;

export const putBoard = (bookId: BookId, body: { id: string; text: string; baseHash: string | null }, keepalive = false): Promise<BoardSave> => {
  const json = JSON.stringify(body);
  const run = fetch(url(bookId), { method: "PUT", headers: { "Content-Type": "application/json" }, body: json, keepalive: keepalive && json.length < KEEPALIVE_LIMIT }).then(
    (response) => answer<BoardSave>(response, "Saving the board"),
  );
  settling(body.id, run);
  return run;
};

export const listBoards = async (bookId: BookId): Promise<BoardSummary[]> =>
  (await answer<{ boards: BoardSummary[] }>(await fetch(url(bookId), { cache: "no-store" }), "Listing the boards")).boards;

export const chapterBoard = async (bookId: BookId, chapter: string, labels: string[]): Promise<Board> =>
  answer<Board>(await post(bookId, { op: "chapter", chapter, labels }), "Opening the chapter's board");

export const createBoard = async (
  bookId: BookId,
  body: { title: string; chapter: string | null; labels: string[]; text?: string; source?: string },
): Promise<Board> => answer<Board>(await post(bookId, { op: "create", ...body }), "Making the board");

export const renameBoard = async (bookId: BookId, id: string, title: string): Promise<Board> =>
  answer<Board>(await post(bookId, { op: "rename", id, title }), "Renaming the board");

export const removeBoard = async (bookId: BookId, id: string): Promise<void> => {
  const response = await post(bookId, { op: "remove", id });
  if (!response.ok) await answer(response, "Removing the board");
};

export type BoardRequest =
  | { op: "review" | "check"; id: string; provider: ProviderId; scene: CompactScene; image: string | null }
  | { op: "edit"; id: string; provider: ProviderId; scene: CompactScene; image: string | null; instruction: string };

export const askBoard = async (bookId: BookId, body: BoardRequest, signal: AbortSignal): Promise<BoardAnswer> =>
  answer<BoardAnswer>(await post(bookId, body, signal), "Asking the tutor");
