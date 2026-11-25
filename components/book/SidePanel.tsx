"use client";

import { memo, useState } from "react";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { HighlightsTab } from "@/components/annotations/HighlightsTab";
import { NotesTab, type NoteDraft } from "@/components/annotations/NotesTab";
import type { AnnotationsApi } from "@/components/annotations/useAnnotations";
import { BoardsTab } from "@/components/board/BoardsTab";
import type { BoardContext, BoardsApi } from "@/components/board/useBoards";
import { CardsTab } from "@/components/cards/CardsTab";
import type { CardsApi } from "@/components/cards/useCards";
import { ChatTab } from "@/components/chat/ChatTab";
import type { QuoteDraft } from "@/components/chat/Quotes";
import { usePill } from "@/components/ui/pill";
import type { MessageDraft, Tutor } from "@/components/chat/useTutor";
import type { Anchor, CardSet, Highlight, PanelTab, ProviderId, QuotedPassage } from "@/lib/shared/types";
import type { PlaceStore } from "./place";

/* New content fades in after a pointer choice only; a keyboard switch, used far more often, is instant. */
const panelClass =
  "flex min-h-0 flex-1 flex-col outline-none [&:not([data-selected])]:hidden group-data-[slide]/tabs:transition-opacity group-data-[slide]/tabs:duration-[var(--duration-fast)] group-data-[slide]/tabs:ease-out group-data-[slide]/tabs:data-[starting-style]:opacity-0";

const TABS: { value: PanelTab; label: string }[] = [
  { value: "chat", label: "Chat" },
  { value: "notes", label: "Notes" },
  { value: "highlights", label: "Highlights" },
  { value: "cards", label: "Cards" },
  { value: "board", label: "Board" },
];

/** The right panel: the tutor chat, and the book's notes, highlights, cards and whiteboards. Memoised, so it skips the workspace's renders that change nothing here. */
export const SidePanel = memo(function SidePanel({
  tab,
  onTabChange,
  tutor,
  unavailable,
  onJump,
  onAsk,
  onSendParked,
  onReply,
  onRetry,
  annotations,
  noteDraft,
  noteFocus,
  onNoteDraft,
  onOpenNote,
  quotes,
  onFindQuote,
  onQuote,
  cards,
  onReview,
  onRemakeCards,
  panelOpen,
  boards,
  spot,
  boardContext,
  provider,
  theme,
  onDraw,
  onAnswerFromBoard,
}: {
  tab: PanelTab;
  onTabChange(tab: PanelTab): void;
  tutor: Tutor;
  unavailable: string | null;
  onJump(anchor: Anchor): void;
  onAsk(draft: MessageDraft): void;
  onSendParked(id: string): void;
  onReply(draft: MessageDraft): void;
  onRetry(): void;
  annotations: AnnotationsApi;
  noteDraft: NoteDraft | null;
  noteFocus: { id: string; at: number } | null;
  onNoteDraft(draft: NoteDraft | null): void;
  onOpenNote(noteId: string): void;
  /** Passages quoted into the chat's composer. */
  quotes: QuoteDraft;
  onFindQuote(quote: QuotedPassage): Promise<boolean>;
  /** Quotes a highlight into the chat's composer. */
  onQuote(highlight: Highlight): void;
  cards: CardsApi;
  onReview(): void;
  /** Asks the tutor for a better card on a set's passage, or null with no tutor to ask. */
  onRemakeCards: ((set: CardSet) => void) | null;
  /** The panel is expanded, so its tab can be seen. */
  panelOpen: boolean;
  boards: BoardsApi;
  spot: PlaceStore;
  boardContext: BoardContext;
  provider: ProviderId | null;
  theme: "light" | "dark";
  /** Asks the tutor, in the chat, to draw something as a board. */
  onDraw(text: string): void;
  onAnswerFromBoard(text: string): void;
}) {
  const { groupRef, pill, sliding, choose } = usePill(tab, "[data-selected]");
  const [keyed, setKeyed] = useState(false);
  return (
    <Tabs
      value={tab}
      onValueChange={(value, details) => {
        if (!value) return;
        const pointer = details.source === "mouse" || details.source === "touch" || details.source === "pen";
        choose(value as PanelTab, pointer);
        setKeyed(!pointer);
        onTabChange(value as PanelTab);
      }}
      data-slide={sliding || undefined}
      className="group/tabs flex h-full min-w-0 flex-col"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 px-1.5">
        <TabsList ref={groupRef} aria-label="Panel" className="group/pill relative flex h-8 flex-1 items-center gap-0.5 rounded-md bg-tint p-0.5">
          {pill}
          {TABS.map(({ value, label }) => (
            <TabsTab
              key={value}
              value={value}
              className="press relative h-7 flex-1 rounded-sm px-2.5 text-label font-medium text-dim outline-none transition-[color,scale] duration-[var(--duration-fast)] hover:text-paper focus-visible:outline-2 focus-visible:outline-accent data-[selected]:bg-panel-raised data-[selected]:text-paper data-[selected]:shadow-chip group-data-[placed]/pill:data-[selected]:bg-transparent group-data-[placed]/pill:data-[selected]:shadow-none"
            >
              {label}
            </TabsTab>
          ))}
        </TabsList>
      </div>
      <TabsPanel value="chat" className={panelClass}>
        <ChatTab shown={panelOpen && tab === "chat"} keyed={keyed} tutor={tutor} unavailable={unavailable} onJump={onJump} onAsk={onAsk} onSendParked={onSendParked} onReply={onReply} onRetry={onRetry} onSaveNote={annotations.addNote} quotes={quotes} onFindQuote={onFindQuote} />
      </TabsPanel>
      <TabsPanel value="notes" className={panelClass}>
        <NotesTab
          notes={annotations.notes}
          draft={noteDraft}
          focus={noteFocus}
          vault={annotations.vault}
          onDraft={onNoteDraft}
          onAdd={(selection, body) => {
            annotations.addNote(selection, body);
            onNoteDraft(null);
          }}
          onEdit={(id, body) => {
            annotations.editNote(id, body);
            onNoteDraft(null);
          }}
          onRemove={annotations.removeNote}
          onJump={onJump}
        />
      </TabsPanel>
      <TabsPanel value="highlights" className={panelClass}>
        <HighlightsTab
          highlights={annotations.highlights}
          notes={annotations.notes}
          vault={annotations.vault}
          onJump={onJump}
          onRemove={annotations.removeHighlight}
          onOpenNote={onOpenNote}
          onQuote={onQuote}
        />
      </TabsPanel>
      <TabsPanel value="cards" className={panelClass}>
        <CardsTab cards={cards} onReview={onReview} onJump={onJump} onRemake={onRemakeCards} />
      </TabsPanel>
      <TabsPanel value="board" className={panelClass}>
        <BoardsTab
          boards={boards}
          shown={panelOpen && tab === "board"}
          bookId={tutor.bookId}
          spot={spot}
          context={boardContext}
          provider={provider}
          unavailable={unavailable}
          theme={theme}
          onDraw={onDraw}
          onAnswer={onAnswerFromBoard}
        />
      </TabsPanel>
    </Tabs>
  );
});
