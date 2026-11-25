import { connection } from "next/server";
import { findThree, focusPreview, startFocus, stopFocus, threeRunner } from "@/lib/server/focus";
import { shortText } from "@/lib/server/validate";
import { readObject } from "@/lib/server/with-book";
import { clampFocusMinutes, MAX_FOCUS_MINUTES, MIN_FOCUS_MINUTES } from "@/lib/shared/focus";

const run = async () => {
  const bin = await findThree();
  return bin ? threeRunner(bin) : null;
};

/** What a focus session would block right now. */
export async function GET() {
  await connection();
  return Response.json({ blocking: await focusPreview(await run()) });
}

/** Starts a session: { title, minutes }. Three refusing it is not an error; the answer says nothing is blocked. */
export async function POST(request: Request) {
  const body = await readObject(request);
  /* A long title is trimmed, not refused: refusing it would cost the session its blocking. */
  const title = typeof body?.title === "string" ? shortText(body.title.slice(0, 500), 500) : null;
  const minutes = clampFocusMinutes(body?.minutes);
  if (!title || minutes === null) {
    return Response.json({ error: `Send a title and whole minutes from ${MIN_FOCUS_MINUTES} to ${MAX_FOCUS_MINUTES}.` }, { status: 400 });
  }
  return Response.json(await startFocus(await run(), { title, minutes }));
}

/** Ends a session early: { sessionId }. Stops Three only when that session is still the one running. */
export async function DELETE(request: Request) {
  const body = await readObject(request);
  const sessionId = shortText(body?.sessionId, 100);
  if (!sessionId) return Response.json({ error: "Send the sessionId to stop." }, { status: 400 });
  try {
    return Response.json({ stopped: await stopFocus(await run(), sessionId) });
  } catch (error) {
    return Response.json({ error: `Three couldn’t stop the session: ${(error as Error).message}` }, { status: 502 });
  }
}
