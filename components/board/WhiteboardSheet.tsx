"use client";

import { createContext } from "react";
import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui";
import type { BoardSummary } from "@/lib/shared/boards";
import type { WhiteboardProps } from "./Whiteboard";

/** Where a Mermaid diagram from the chat can go, where the book allows it: the book's boards, and a way onto one. */
export interface DiagramBoards {
  boards: readonly BoardSummary[];
  /** Puts the diagram on the board `boardId`, or on a board of its own when null; says how many suggestions it made. */
  add(source: string, boardId: string | null): Promise<number | null>;
}

export const OpenAsBoard = createContext<DiagramBoards | null>(null);

/* Excalidraw is large; the book loads it the first time a board is opened. */
const Whiteboard = dynamic(() => import("./Whiteboard"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-page">
      <Spinner />
    </div>
  ),
});

/** A chapter's whiteboard over the book. */
export function WhiteboardSheet(props: WhiteboardProps) {
  return <Whiteboard {...props} />;
}
