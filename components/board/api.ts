import type { BoardAnswer, BoardSave, CompactScene, OpenedBoard } from "@/lib/shared/boards";
import type { BookId, ProviderId } from "@/lib/shared/types";

const url = (bookId: BookId) => `/api/books/${bookId}/boards`;

const answer = async <T>(response: Response, doing: string): Promise<T> => {
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error ?? `${doing} failed (${response.status}).`);
  return body;
};

export const fetchBoard = async (bookId: BookId, chapter: string): Promise<OpenedBoard> =>
  answer<OpenedBoard>(await fetch(`${url(bookId)}?chapter=${encodeURIComponent(chapter)}`), "Opening the board");

export const putBoard = async (bookId: BookId, body: { chapter: string; labels: string[]; text: string; baseHash: string | null }, keepalive = false): Promise<BoardSave> =>
  answer<BoardSave>(await fetch(url(bookId), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive }), "Saving the board");

export type BoardRequest =
  | { op: "review" | "check"; chapter: string; labels: string[]; provider: ProviderId; scene: CompactScene; image: string | null }
  | { op: "edit"; chapter: string; labels: string[]; provider: ProviderId; scene: CompactScene; image: string | null; instruction: string };

export const askBoard = async (bookId: BookId, body: BoardRequest, signal: AbortSignal): Promise<BoardAnswer> =>
  answer<BoardAnswer>(await fetch(url(bookId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal }), "Asking the tutor");
