import {
  askAboutBoard,
  BoardError,
  chapterBoard,
  createBoard,
  listBoards,
  NoSuchBoard,
  openBoard,
  recordAttempt,
  removeBoard,
  renameBoard,
  saveBoard,
  type BoardAsk,
} from "@/lib/server/boards";
import { sniffImage } from "@/lib/server/attachments";
import { getFolders } from "@/lib/server/config";
import { contentHash } from "@/lib/server/notes-folder";
import { withNotes } from "@/lib/server/notes-route";
import { readSettings } from "@/lib/server/settings";
import { readBookState } from "@/lib/server/store";
import { PROVIDERS, isProviderId, modelFor } from "@/lib/server/tutor/providers";
import type { TutorImage } from "@/lib/server/tutor/types";
import { isObject, shortText } from "@/lib/server/validate";
import { readBody, withBook } from "@/lib/server/with-book";
import { EMPTY_BOARD, isBoardId, parseCompactScene } from "@/lib/shared/boards";
import type { BookId } from "@/lib/shared/types";

const badRequest = (error: string) => Response.json({ error }, { status: 400 });

const parseLabels = (value: unknown, chapter: string | null): string[] => {
  const labels = Array.isArray(value) ? value.map((label) => shortText(label, 500)).filter((label): label is string => !!label).slice(0, 200) : [];
  return !chapter || labels.includes(chapter) ? labels : [chapter, ...labels];
};

/* A PNG of the board for the tutor to look at; the page sends it scaled down. */
const MAX_IMAGE_CHARS = 8_000_000;
/* The diagram a board was made from is only hashed, never kept. */
const MAX_SOURCE_CHARS = 100_000;

/** The board's picture: null when none was sent, the image as its bytes say it is, or undefined when it isn't one. */
const parseImage = (value: unknown): TutorImage | null | undefined => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return undefined;
  const info = sniffImage(Buffer.from(value, "base64"));
  return info ? { mediaType: info.mediaType, data: value } : undefined;
};

/* A board that went missing, such as one removed in another window. */
const missing = async (run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof NoSuchBoard) return Response.json({ error: error.message }, { status: 404 });
    throw error;
  }
};

const bookTitleOf = async (book: { id: BookId; fileTitle: string }) => (await readBookState(book.id)).meta?.title ?? book.fileTitle;

/** `?id=`: a board, with its file (text and hash), or null before the first save. Without an id: the book's boards. */
export const GET = withBook(async ({ book, request }) => {
  const id = new URL(request.url).searchParams.get("id");
  if (id === null) return Response.json({ boards: await listBoards(getFolders().notes.path, book.id) });
  if (!isBoardId(id)) return badRequest("Expected ?id= of a board.");
  return withNotes((notesDir) => missing(async () => Response.json(await openBoard(notesDir, book.id, id))));
});

/** Saves a board: `{ id, text, baseHash }`, baseHash null for a board with no file yet. */
export const PUT = withBook(async ({ book, request }) => {
  const body = await readBody(request);
  if (!isObject(body)) return badRequest("Expected a JSON object.");
  if (!isBoardId(body.id) || typeof body.text !== "string" || (body.baseHash !== null && typeof body.baseHash !== "string")) {
    return badRequest("Expected { id, text, baseHash }.");
  }
  const { id, text, baseHash } = body;
  const bookTitle = await bookTitleOf(book);
  return withNotes((notesDir) => missing(async () => Response.json(await saveBoard(notesDir, { bookId: book.id, bookTitle }, { id, text, baseHash }))));
});

/**
 * Changes the book's list of boards, or asks the tutor about one:
 * - `{ op: "chapter", chapter, labels, occurrence? }`: the chapter's board, added the first time. `occurrence` tells a
 *   later chapter of the same title from the first.
 * - `{ op: "create", title, chapter, labels, text?, source? }`: a new board of the reader's, empty or with `text`. With the
 *   chat diagram it was made from as `source`, the same diagram opens the same board.
 * - `{ op: "rename", id, title }` and `{ op: "remove", id }`. Removing keeps the file.
 * - `{ op: "review" | "check", id, provider, scene, image }`, where `scene` is the compact scene. A check is a draw-it-back
 *   on a chapter's board, and its result is recorded for retention. Changes the reader asks for go through the chat.
 */
export const POST = withBook(async ({ book, request }) => {
  const body = await readBody(request);
  if (!isObject(body)) return badRequest("Expected a JSON object.");

  if (body.op === "chapter") {
    const chapter = shortText(body.chapter, 500);
    if (!chapter) return badRequest("Expected a chapter.");
    const occurrence = body.occurrence ?? 0;
    if (!Number.isInteger(occurrence) || (occurrence as number) < 0 || (occurrence as number) > 999) return badRequest("Expected which chapter of that name.");
    return Response.json(await chapterBoard(book.id, chapter, parseLabels(body.labels, chapter), occurrence as number));
  }
  if (body.op === "create") {
    const title = shortText(body.title, 200);
    if (!title) return badRequest("Give the board a title.");
    const chapter = body.chapter === undefined || body.chapter === null ? null : shortText(body.chapter, 500);
    if (body.chapter !== undefined && body.chapter !== null && !chapter) return badRequest("Expected a chapter, or null.");
    if (body.text !== undefined && typeof body.text !== "string") return badRequest("Expected the board's text.");
    if (body.source !== undefined && (typeof body.source !== "string" || !body.source.trim() || body.source.length > MAX_SOURCE_CHARS)) {
      return badRequest("Expected the diagram the board was made from.");
    }
    const bookTitle = await bookTitleOf(book);
    return withNotes(async (notesDir) =>
      Response.json(
        await createBoard(
          notesDir,
          { bookId: book.id, bookTitle },
          {
            title,
            chapter,
            labels: parseLabels(body.labels, chapter),
            text: (body.text as string | undefined) ?? EMPTY_BOARD,
            from: typeof body.source === "string" ? contentHash(body.source) : null,
          },
        ),
      ),
    );
  }

  if (!isBoardId(body.id)) return badRequest("Expected the board's id.");
  const id = body.id;
  if (body.op === "rename") {
    const title = shortText(body.title, 200);
    if (!title) return badRequest("Give the board a title.");
    return missing(async () => Response.json(await renameBoard(book.id, id, title)));
  }
  if (body.op === "remove") {
    return missing(async () => {
      try {
        await removeBoard(book.id, id);
      } catch (error) {
        if (error instanceof BoardError) return badRequest(error.message);
        throw error;
      }
      return new Response(null, { status: 204 });
    });
  }

  if (!isProviderId(body.provider)) return badRequest("Unknown provider.");
  const scene = parseCompactScene(body.scene);
  if (!scene) return badRequest("Expected the board as a compact scene.");
  if (body.op !== "review" && body.op !== "check") return badRequest('op is "chapter", "create", "rename", "remove", "review" or "check".');
  const ask: BoardAsk = { kind: body.op };
  if (ask.kind === "check" && !scene.links.length) return badRequest("Draw arrows between the ideas first: the check is about how they connect.");
  if (ask.kind === "review" && !scene.nodes.length) return badRequest("The board is empty.");
  const image = parseImage(body.image);
  if (image === undefined) return badRequest("Expected the board's picture as a base64 image, or null.");

  const [state, settings] = await Promise.all([readBookState(book.id), readSettings()]);
  const board = state.boards.find((entry) => entry.id === id);
  if (!board) return Response.json({ error: "That board isn't in this book any more." }, { status: 404 });
  if (!board.chapter) return badRequest("This board isn't about a chapter, so the tutor has nothing to read it against.");
  if (ask.kind === "check" && board.kind !== "chapter") return badRequest("Draw it back is for a chapter's own board.");
  const label = { title: state.meta?.title ?? book.fileTitle, author: state.meta?.author ?? book.fileAuthor };
  try {
    const answer = await askAboutBoard(
      PROVIDERS[body.provider],
      { bookId: book.id, book: label, chapter: board.chapter, labels: board.labels, scene, image, ask },
      modelFor(settings.models, body.provider),
      request.signal,
    );
    if (answer.kind !== "check") return Response.json(answer);
    const attempts = await recordAttempt(book.id, id, { at: new Date().toISOString(), correct: answer.check.wrong === null });
    return Response.json({ ...answer, attempts });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    if (error instanceof NoSuchBoard) return Response.json({ error: error.message }, { status: 404 });
    return Response.json({ error: error instanceof Error ? error.message : "The tutor couldn't answer." }, { status: 502 });
  }
});
