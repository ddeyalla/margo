"use client";

import type { ReaderPlace, TocEntry } from "@/components/reader/types";
import { useStore, type Store } from "@/components/ui/store";
import type { Position } from "@/lib/shared/types";

/** Where the reader is, reported on every scroll frame; null until the book first reports. */
export interface ReadingSpot {
  position: Position;
  place: ReaderPlace | null;
}

export type PlaceStore = Store<ReadingSpot | null>;

/** The chapter being read. Re-renders only when the chapter changes, not on every scroll frame. */
export const useChapter = (store: PlaceStore): TocEntry | null => useStore(store, (spot) => spot?.place?.chapter ?? null);
