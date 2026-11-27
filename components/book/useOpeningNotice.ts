"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ReaderHandle } from "@/components/reader/types";
import { consumeRefreshMark } from "@/lib/client/open";
import { recentMarks, shouldShowResume } from "@/lib/shared/resume";
import { reviewQueue } from "@/lib/shared/schedule";
import type { BookState, DailyLoad, Highlight, Note } from "@/lib/shared/types";
import type { OpeningNotice } from "./OpeningNotice";
import type { PlaceStore } from "./place";

/** How long the place must hold still before the greeting says where the reader left off. */
const SETTLE_MS = 700;

/**
 * What greets the reader on a fresh open: where they left off, and the cards that are due.
 * `placeMoved` is told of every place the book reports; `navigate` moves the book, which ends the greeting.
 */
export function useOpeningNotice({
  initialState,
  dailyLoad,
  readerRef,
  spot,
  highlights,
  notes,
}: {
  initialState: BookState;
  dailyLoad: DailyLoad;
  readerRef: RefObject<ReaderHandle | null>;
  spot: PlaceStore;
  highlights: Highlight[];
  notes: Note[];
}) {
  const [notice, setNotice] = useState<OpeningNotice | null>(null);
  /* Decided once, on the first page of this open; null means there is nothing to show. */
  const greeting = useRef<{ resume: boolean; due: number } | null>(null);
  const dismiss = useCallback(() => {
    greeting.current = null;
    setNotice(null);
  }, []);
  /* The book reports a place or two while it settles; the greeting waits for the place to hold still. */
  const settleTimer = useRef(0);
  const [settled, setSettled] = useState(false);
  const greeted = useRef(false);
  useEffect(() => {
    if (greeted.current) return;
    greeted.current = true;
    /* A page rebuilt after another window changed the book is not an open. */
    if (consumeRefreshMark()) return;
    const resume = shouldShowResume(initialState.position !== null, initialState.lastReadAt, new Date());
    const due = reviewQueue(initialState.cardSets, new Date(), dailyLoad).length;
    if (resume || due > 0) greeting.current = { resume, due };
  }, [initialState, dailyLoad]);

  /* Once the place has held still, the greeting is made from it: where the reader left off is where the book now is. */
  useEffect(() => {
    const hello = greeting.current;
    const here = spot.get();
    if (!settled || !hello || !here) return;
    greeting.current = null;
    const { position } = here;
    const chapterLabel = here.place?.chapter?.label ?? null;
    const glimpse = hello.resume ? readerRef.current?.peek(position) ?? null : null;
    setNotice({
      resume: hello.resume
        ? { glimpse: glimpse?.text ?? null, before: glimpse?.before ?? null, chapter: chapterLabel, fraction: position.fraction, marks: recentMarks(highlights, notes, chapterLabel) }
        : null,
      due: hello.due,
    });
  }, [settled, spot, highlights, notes, readerRef]);
  useEffect(() => () => clearTimeout(settleTimer.current), []);

  const placeMoved = () => {
    if (!greeting.current) return;
    clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => setSettled(true), SETTLE_MS);
  };

  const navigate = useCallback(
    (move: (reader: ReaderHandle) => unknown) => {
      dismiss();
      const reader = readerRef.current;
      if (reader) void move(reader);
    },
    [dismiss, readerRef],
  );

  return { notice, dismiss, placeMoved, navigate };
}
