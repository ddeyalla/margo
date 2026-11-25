import { askAboutBoard, openBoard, recordAttempt, saveBoard, type BoardAsk } from "@/lib/server/boards";
import { withNotes } from "@/lib/server/notes-route";
import { readSettings } from "@/lib/server/settings";
import { readBookState } from "@/lib/server/store";
import { PROVIDERS, isProviderId, modelFor } from "@/lib/server/tutor/providers";
import type { TutorImage } from "@/lib/server/tutor/types";
import { isObject, shortText } from "@/lib/server/validate";
import { readBody, withBook } from "@/lib/server/with-book";
import { parseCompactScene } from "@/lib/shared/boards";

const badRequest = (error: string) => Response.json({ error }, { status: 400 });

const parseLabels = (value: unknown, chapter: string): string[] => {
  const labels = Array.isArray(value) ? value.map((label) => shortText(label, 500)).filter((label): label is string => !!label).slice(0, 200) : [];
  return labels.includes(chapter) ? labels : [chapter, ...labels];
};

/* A PNG of the board for the tutor to look at; the page sends it scaled down. */
const MAX_IMAGE_CHARS = 8_000_000;

const parseImage = (value: unknown): TutorImage | null =>
  typeof value === "string" && value.length <= MAX_IMAGE_CHARS && /^[A-Za-z0-9+/]+=*$/.test(value) ? { mediaType: "image/png", data: value } : null;

/** A chapter's board: `?chapter=`. Answers its file (text and hash), or null before the first save, and its draw-it-back attempts. */
export const GET = withBook(async ({ book, request }) => {
  const chapter = shortText(new URL(request.url).searchParams.get("chapter"), 500);
  if (!chapter) return badRequest("Expected ?chapter=.");
  return withNotes(async (notesDir) => Response.json(await openBoard(notesDir, book.id, chapter)));
});

/** Saves a board: `{ chapter, labels, text, baseHash }`, baseHash null for a board with no file yet. */
export const PUT = withBook(async ({ book, request }) => {
  const body = await readBody(request);
  if (!isObject(body)) return badRequest("Expected a JSON object.");
  const chapter = shortText(body.chapter, 500);
  if (!chapter || typeof body.text !== "string" || (body.baseHash !== null && typeof body.baseHash !== "string")) {
    return badRequest("Expected { chapter, labels, text, baseHash }.");
  }
  const { text, baseHash } = body;
  const state = await readBookState(book.id);
  const bookTitle = state.meta?.title ?? book.fileTitle;
  return withNotes(async (notesDir) =>
    Response.json(await saveBoard(notesDir, { bookId: book.id, bookTitle }, { chapter, labels: parseLabels(body.labels, chapter), text, baseHash })),
  );
});

/**
 * Asks the tutor about a board: `{ op: "review" | "check" | "edit", chapter, labels, provider, scene, image, instruction? }`.
 * `scene` is the compact scene. A check is a draw-it-back, and its result is recorded for retention.
 */
export const POST = withBook(async ({ book, request }) => {
  const body = await readBody(request);
  if (!isObject(body)) return badRequest("Expected a JSON object.");
  const chapter = shortText(body.chapter, 500);
  if (!chapter) return badRequest("Expected a chapter.");
  if (!isProviderId(body.provider)) return badRequest("Unknown provider.");
  const scene = parseCompactScene(body.scene);
  if (!scene) return badRequest("Expected the board as a compact scene.");
  let ask: BoardAsk;
  if (body.op === "review" || body.op === "check") ask = { kind: body.op };
  else if (body.op === "edit") {
    const instruction = shortText(body.instruction, 2000);
    if (!instruction) return badRequest("Say what to change on the board.");
    ask = { kind: "edit", instruction };
  } else return badRequest('op is "review", "check" or "edit".');
  if (ask.kind === "check" && !scene.links.length) return badRequest("Draw arrows between the ideas first: the check is about how they connect.");
  if (ask.kind === "review" && !scene.nodes.length) return badRequest("The board is empty.");

  const labels = parseLabels(body.labels, chapter);
  const [state, settings] = await Promise.all([readBookState(book.id), readSettings()]);
  const label = { title: state.meta?.title ?? book.fileTitle, author: state.meta?.author ?? book.fileAuthor };
  try {
    const answer = await askAboutBoard(
      PROVIDERS[body.provider],
      { bookId: book.id, book: label, chapter, labels, scene, image: parseImage(body.image), ask },
      modelFor(settings.models, body.provider),
      request.signal,
    );
    if (answer.kind !== "check") return Response.json(answer);
    const attempts = await recordAttempt(book.id, chapter, labels, { at: new Date().toISOString(), correct: answer.check.wrong === null });
    return Response.json({ ...answer, attempts });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return Response.json({ error: error instanceof Error ? error.message : "The tutor couldn't answer." }, { status: 502 });
  }
});
