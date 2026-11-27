import { cardRequest, generateCards, verifyCards } from "@/lib/server/cards/generate";
import { storeCards } from "@/lib/server/cards/store";
import { CardGradeError, gradeCardAnswer } from "@/lib/server/cards/grade";
import { checkerFor } from "@/lib/server/check/provider";
import { getConfig } from "@/lib/server/config";
import { readSettings } from "@/lib/server/settings";
import { noteEvidence } from "@/lib/server/ledger";
import { BookClosedError, readBookState, updateBookState } from "@/lib/server/store";
import { PROVIDERS, isProviderId, modelFor } from "@/lib/server/tutor/providers";
import { isObject, MAX_QUOTE, parseAnchor, shortText } from "@/lib/server/validate";
import { mirrorVault } from "@/lib/server/vault";
import { readBody, withBook } from "@/lib/server/with-book";
import { changeCards, type CardChange } from "@/lib/shared/cards";
import { sameAnchor } from "@/lib/shared/annotations";
import { trimAfter, trimBefore } from "@/lib/shared/context";
import { cleanStance, isConfidence } from "@/lib/shared/confidence";
import { evidenceOf } from "@/lib/shared/ledger";
import { isRating } from "@/lib/shared/types";

const MAX_FIELD = 2_000;

const dirs = () => {
  const { dataDir, notesDir } = getConfig();
  return [dataDir, notesDir] as const;
};

const badRequest = (error: string) => Response.json({ error }, { status: 400 });

/**
 * `{ op: "grade", provider, setId, cueId, answer }` grades a written answer to a free card and answers `{ grade }`;
 * nothing is rated by it. Otherwise: makes cards for a selected passage through the chosen tutor, checks each
 * against the passage, and stores those that pass.
 * Answers with every card set, how many cues were added and, when none were,
 * why. Takes as long as the tutor does; nothing is stored if it fails.
 */
export const POST = withBook(async ({ book, request }) => {
  const body = await readBody(request);
  if (!isObject(body) || !isProviderId(body.provider)) return badRequest("Expected { provider, selection }, or { op: \"grade\", provider, setId, cueId, answer }.");
  if (body.op === "grade") {
    try {
      return Response.json({ grade: await gradeCardAnswer(book.id, body.setId, body.cueId, body.answer, checkerFor(body.provider), request.signal) });
    } catch (error) {
      if (error instanceof CardGradeError) return badRequest(error.message);
      if (error instanceof BookClosedError) throw error;
      if (request.signal.aborted) return new Response(null, { status: 499 });
      return Response.json({ error: error instanceof Error ? error.message : "The answer couldn't be graded." }, { status: 502 });
    }
  }
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
  const existing = state.cardSets.find((set) => sameAnchor(set.anchor, anchor)) ?? null;
  const model = modelFor(settings.models, providerId);

  let reply;
  let verified;
  try {
    reply = await generateCards(PROVIDERS[providerId], cardRequest(label, source, existing), model, request.signal);
    if (reply.fact !== null) verified = await verifyCards(checkerFor(providerId), source, reply.cards, request.signal);
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return Response.json({ error: error instanceof Error ? error.message : "The tutor could not make cards." }, { status: 502 });
  }

  if (reply.fact === null || !verified) return Response.json({ cardSets: state.cardSets, added: 0, reason: reply.fact === null ? reply.reason : null });
  if (!verified.kept.length) {
    return Response.json({
      cardSets: state.cardSets,
      added: 0,
      reason: `The tutor's cards didn't hold up when checked against the passage, so none were saved. ${verified.dropped[0]?.reason ?? ""}`.trim(),
    });
  }
  const [dataDir, notesDir] = dirs();
  const { cardSets, added } = await storeCards(book, { anchor, ...source, fact: reply.fact, cards: verified.kept }, { dataDir, notesDir });
  return Response.json({
    cardSets,
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
    const confidence = body.confidence ?? null;
    const thinking = body.thinking ?? null;
    if (confidence !== null && !isConfidence(confidence)) return "confidence is a whole number from 0 to 100, or null.";
    if (thinking !== null && typeof thinking !== "string") return "thinking is a line of text, or null.";
    if (body.aided !== undefined && typeof body.aided !== "boolean") return "aided is true or false.";
    return { op: "review", setId, cueId: body.cueId, rating: body.rating, reps: body.reps as number, ...(body.aided ? { aided: true } : {}), ...cleanStance(confidence, thinking) };
  }
  return 'PATCH takes { op: "edit-cue", setId, cueId, question, answer } or { op: "review", setId, cueId, rating, reps, aided?, confidence?, thinking? }.';
};

/** Edits a card or records a review (PATCH), or deletes a card or a set (DELETE). Answers with every card set. */
const handle = (method: "PATCH" | "DELETE") =>
  withBook(async ({ book, request }) => {
    const change = parseChange(await readBody(request), method);
    if (typeof change === "string") return badRequest(change);
    const saved = await updateBookState(book.id, (state) => ({ ...state, cardSets: changeCards(state.cardSets, change, new Date()) }));
    /* A review changes only the schedule, which the markdown copy doesn't show. */
    if (change.op !== "review") await mirrorVault(book, ...dirs());
    else noteEvidence(evidenceOf(book.id, saved));
    return Response.json({ cardSets: saved.cardSets });
  });

export const PATCH = handle("PATCH");
export const DELETE = handle("DELETE");
