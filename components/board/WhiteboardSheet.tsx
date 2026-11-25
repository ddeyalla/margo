"use client";

import { createContext } from "react";
import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui";
import type { WhiteboardProps } from "./Whiteboard";

/** Turns a Mermaid diagram from the chat into a whiteboard, where the book allows it. */
export const OpenAsBoard = createContext<((source: string) => void) | null>(null);

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
