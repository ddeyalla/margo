"use client";

import type { RefObject } from "react";
import type { MessageDraft, useTutor } from "@/components/chat/useTutor";
import type { ReaderHandle } from "@/components/reader/types";
import { useStableCallback } from "@/components/ui/store";
import { anchorAt } from "@/lib/shared/place";
import type { PanelTab, ProviderId, SelectionContext, TutorAction } from "@/lib/shared/types";
import type { OpeningNotice } from "./OpeningNotice";
import type { ToastMessage } from "./FloatingMessages";
import type { PlaceStore } from "./place";

/** The ways the book hands a passage or a question to the tutor. Each does nothing while no tutor is ready, except parking. */
export function useTutorActions({
  tutor,
  provider,
  readerRef,
  showTab,
  spot,
  onToast,
}: {
  tutor: ReturnType<typeof useTutor>;
  provider: ProviderId | null;
  readerRef: RefObject<ReaderHandle | null>;
  showTab(tab: PanelTab): void;
  spot: PlaceStore;
  onToast(toast: ToastMessage): void;
}) {
  const startThread = (action: TutorAction, selection: SelectionContext, question: string | null) => {
    if (!provider || tutor.sending) return;
    readerRef.current?.clearSelection();
    showTab("chat");
    tutor.start(action, selection, question, provider);
  };

  /* A question with no passage remembers where the reader was, so its thread can lead back there. */
  const askAnywhere = useStableCallback((draft: MessageDraft) => {
    if (!provider) return;
    const here = spot.get();
    tutor.ask(draft, here && { anchor: anchorAt(here.position), chapterTitle: here.place?.chapter?.label ?? null }, provider);
  });

  /* Saves the question on the passage and says so. The panel stays as it is and the tutor is not called. */
  const park = async (selection: SelectionContext, question: string) => {
    readerRef.current?.clearSelection();
    const saved = await tutor.park(selection, question, provider);
    onToast({ text: saved ? "Parked. It waits in the Chat tab." : "Couldn't park that question. Try again.", action: saved });
  };

  const sendParked = useStableCallback((id: string) => {
    if (!provider || tutor.sending) return;
    showTab("chat");
    tutor.unpark(id, provider);
  });

  /*
   * Asks for a recap of what came before the reader's place. Given the text just before it, or, with none, only the place.
   * `onStart` runs once the recap is going ahead.
   */
  const recap = (resume: OpeningNotice["resume"] | undefined, onStart: () => void) => {
    if (!provider || !resume || tutor.sending) return;
    onStart();
    showTab("chat");
    const here = spot.get();
    if (here && resume.glimpse && resume.before !== null) {
      readerRef.current?.clearSelection();
      const selection: SelectionContext = {
        text: resume.glimpse,
        before: resume.before,
        after: "",
        anchor: anchorAt(here.position),
        chapterTitle: here.place?.chapter?.label ?? null,
        rect: { top: 0, left: 0, width: 0, height: 0 },
      };
      tutor.start("recap", selection, null, provider);
    } else {
      askAnywhere({ text: "Give me a short recap of what came before my place in this chapter. Say nothing about what comes after it.", attachments: [] });
    }
  };

  return { startThread, askAnywhere, park, sendParked, recap };
}
