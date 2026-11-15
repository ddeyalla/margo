import { randomUUID } from "node:crypto";
import { cardRequest, generateCards } from "@/lib/server/cards/generate";
import { getConfig } from "@/lib/server/config";
import { readSettings } from "@/lib/server/settings";
import { readBookState, updateBookState } from "@/lib/server/store";
import { CODEX_DEFAULT_MODEL } from "@/lib/server/tutor/codex";
import { PROVIDERS, isProviderId } from "@/lib/server/tutor/providers";
import { isObject, MAX_QUOTE, parseAnchor, shortText } from "@/lib/server/validate";
import { mirrorVault } from "@/lib/server/vault";
import { readBody, withBook } from "@/lib/server/with-book";
import { addCards, changeCards, type CardChange } from "@/lib/shared/cards";
import { sameAnchor } from "@/lib/shared/annotations";
import { trimAfter, trimBefore } from "@/lib/shared/context";
import { isRating, type ProviderId } from "@/lib/shared/types";

const DEFAULT_MODELS: Partial<Record<ProviderId, string>> = { codex: CODEX_DEFAULT_MODEL };
const MAX_FIELD = 2_000;

const dirs = () => {
  const { dataDir, notesDir } = getConfig();
  return [dataDir, notesDir] as const;
};

const badRequest = (error: string) => Response.json({ error }, { status: 400 });

/**
 * Makes cards for a selected passage through the chosen tutor and stores them.
 * Answers with every card set, how many cues were added and, when none were,
 * why. Takes as long as the tutor does; nothing is stored if it fails.
 */
export const POST = withBook(async ({ book, request }) => {
  const body = await readBody(request);
  if (!isObject(body) || !isProviderId(body.provider)) return badRequest("Expected { provider, selection }.");
  const providerId = body.provider;
  const selection = isObject(body.selection) ? body.selection : null;
  const anchor = selection && parseAnchor(selection.anchor, book.format);
  const quote = selection && shortText(selection.text, MAX_QUOTE);
  if (!selection || !anchor || !quote) return badRequest("Invalid selection.");
  const source = {
    quote,
    before: trimBefore(typeof selection.before === "string" ? selection.before : ""),
    after: trimAfter(typeof selection.after === "string" ? selection.after : ""),
    chapterTitle: shortText(selection.chapterTitle, 500),
  };

  const [state, settings] = await Promise.all([readBookState(book.id), readSettings()]);
  const label = { title: state.meta?.title ?? book.fileTitle, author: state.meta?.author ?? book.fileAuthor };
  const existing = state.cardSets.find((set) => sameAnchor(set.anchor, anchor))?.cues ?? [];
  const model = settings.models[providerId] ?? DEFAULT_MODELS[providerId] ?? null;

  let reply;
  try {
    reply = await generateCards(PROVIDERS[providerId], cardRequest(label, source, existing), model, request.signal);
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return Response.json({ error: error instanceof Error ? error.message : "The tutor could not make cards." }, { status: 502 });
  }

  if (reply.fact === null) return Response.json({ cardSets: state.cardSets, added: 0, reason: reply.reason });
  let added = 0;
  const saved = await updateBookState(book.id, (current) => {
    const result = addCards(current.cardSets, { anchor, ...source, fact: reply.fact, cards: reply.cards }, new Date(), randomUUID);
    added = result.count;
    return { ...current, cardSets: result.sets };
  });
  if (added) await mirrorVault(book, ...dirs());
  return Response.json({
    cardSets: saved.cardSets,
    added,
    reason: added ? null : "The tutor found nothing new to ask beyond the cards you already have.",
  });
});

const parseChange = (body: unknown, method: "PATCH" | "DELETE"): CardChange | string => {
  if (!isObject(body) || typeof body.setId !== "string") return "Expected { op, setId }.";
  const { setId } = body;
  if (method === "DELETE") {
    if (body.op === "delete-set") return { op: "delete-set", setId };
    if (body.op === "delete-cue" && typeof body.cueId === "string") return { op: "delete-cue", setId, cueId: body.cueId };
    return 'DELETE takes { op: "delete-set", setId } or { op: "delete-cue", setId, cueId }.';
  }
  if (typeof body.cueId !== "string") return "Expected a cueId.";
  if (body.op === "edit-cue") {
    const question = shortText(body.question, MAX_FIELD);
    const answer = shortText(body.answer, MAX_FIELD);
    if (!question || !answer) return "A card needs a question and an answer.";
    return { op: "edit-cue", setId, cueId: body.cueId, question, answer };
  }
  if (body.op === "review" && isRating(body.rating) && Number.isInteger(body.reps)) {
    return { op: "review", setId, cueId: body.cueId, rating: body.rating, reps: body.reps as number };
  }
  return 'PATCH takes { op: "edit-cue", setId, cueId, question, answer } or { op: "review", setId, cueId, rating, reps }.';
};

/** Edits a card or records a review (PATCH), or deletes a card or a set (DELETE). Answers with every card set. */
const handle = (method: "PATCH" | "DELETE") =>
  withBook(async ({ book, request }) => {
    const change = parseChange(await readBody(request), method);
    if (typeof change === "string") return badRequest(change);
    const saved = await updateBookState(book.id, (state) => ({ ...state, cardSets: changeCards(state.cardSets, change, new Date()) }));
    /* A review changes only the schedule, which the markdown copy doesn't show. */
    if (change.op !== "review") await mirrorVault(book, ...dirs());
    return Response.json({ cardSets: saved.cardSets });
  });

export const PATCH = handle("PATCH");
export const DELETE = handle("DELETE");
