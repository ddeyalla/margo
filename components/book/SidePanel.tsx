"use client";

import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { HighlightsTab } from "@/components/annotations/HighlightsTab";
import { NotesTab, type NoteDraft } from "@/components/annotations/NotesTab";
import type { AnnotationsApi } from "@/components/annotations/useAnnotations";
import { ChatTab } from "@/components/chat/ChatTab";
import { ProviderPicker } from "@/components/chat/ProviderPicker";
import type { MessageDraft, Tutor } from "@/components/chat/useTutor";
import type { Anchor, PanelTab, ProviderId, ProviderInfo } from "@/lib/shared/types";

const TABS: { value: PanelTab; label: string }[] = [
  { value: "chat", label: "Chat" },
  { value: "notes", label: "Notes" },
  { value: "highlights", label: "Highlights" },
];

/** The right panel: the tutor chat, and the book's notes and highlights. */
export function SidePanel({
  tab,
  onTabChange,
  tutor,
  providers,
  provider,
  unavailable,
  onProvider,
  onJump,
  onAsk,
  onReply,
  onRetry,
  annotations,
  noteDraft,
  noteFocus,
  onNoteDraft,
  onOpenNote,
}: {
  tab: PanelTab;
  onTabChange(tab: PanelTab): void;
  tutor: Tutor;
  providers: ProviderInfo[] | null;
  provider: ProviderId | null;
  unavailable: string | null;
  onProvider(id: ProviderId): void;
  onJump(anchor: Anchor): void;
  onAsk(draft: MessageDraft): void;
  onReply(draft: MessageDraft): void;
  onRetry(): void;
  annotations: AnnotationsApi;
  noteDraft: NoteDraft | null;
  noteFocus: { id: string; at: number } | null;
  onNoteDraft(draft: NoteDraft | null): void;
  onOpenNote(noteId: string): void;
}) {
  return (
    <Tabs value={tab} onValueChange={(value) => value && onTabChange(value as PanelTab)} className="flex h-full min-w-0 flex-col bg-panel">
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <TabsList aria-label="Panel" className="flex h-7 items-center gap-0.5 rounded-sm bg-panel-raised p-0.5">
          {TABS.map(({ value, label }) => (
            <TabsTab
              key={value}
              value={value}
              className="press h-6 rounded-xs px-2.5 text-label text-dim outline-none transition-colors duration-[var(--duration-fast)] hover:text-paper focus-visible:outline-2 focus-visible:outline-accent data-[selected]:bg-panel-hover data-[selected]:text-paper"
            >
              {label}
            </TabsTab>
          ))}
        </TabsList>
        <span className="min-w-0 flex-1" />
        {tab === "chat" ? <ProviderPicker providers={providers} current={provider} onSelect={onProvider} /> : null}
      </div>
      <TabsPanel value="chat" className="flex min-h-0 flex-1 flex-col outline-none data-[selected]:flex [&:not([data-selected])]:hidden">
        <ChatTab tutor={tutor} unavailable={unavailable} onJump={onJump} onAsk={onAsk} onReply={onReply} onRetry={onRetry} />
      </TabsPanel>
      <TabsPanel value="notes" className="flex min-h-0 flex-1 flex-col outline-none [&:not([data-selected])]:hidden">
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
      <TabsPanel value="highlights" className="flex min-h-0 flex-1 flex-col outline-none [&:not([data-selected])]:hidden">
        <HighlightsTab
          highlights={annotations.highlights}
          notes={annotations.notes}
          vault={annotations.vault}
          onJump={onJump}
          onRemove={annotations.removeHighlight}
          onOpenNote={onOpenNote}
        />
      </TabsPanel>
    </Tabs>
  );
}
