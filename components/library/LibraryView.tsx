"use client";

import { LayoutGrid, Library } from "lucide-react";
import { patchSettings } from "@/lib/client/api";
import type { LibraryView as View } from "@/lib/shared/types";
import { Segmented } from "@/components/ui";
import { createStore, useStore } from "@/components/ui/store";
import { BookList, type Shelf, type ShelfBook } from "./BookList";
import { ShelfView } from "./ShelfView";

/* The toggle and the books sit in different parts of the page, so they share the choice here. null until
   the reader picks one on this page, when the view the server rendered with still holds. */
const chosen = createStore<View | null>(null);

const useView = (saved: View) => useStore(chosen, (view) => view) ?? saved;

const choose = (view: View) => {
  chosen.set(view);
  void patchSettings({ libraryView: view });
};

const OPTIONS: { value: View; label: string; icon: React.ReactNode }[] = [
  { value: "shelf", label: "Shelf", icon: <Library /> },
  { value: "grid", label: "Grid", icon: <LayoutGrid /> },
];

/** Switches the library between the shelf of 3D books and the grid of covers, and saves the choice. */
export function LibraryViewToggle({ saved }: { saved: View }) {
  return <Segmented label="Library view" options={OPTIONS} value={useView(saved)} onChange={choose} />;
}

/** The books, in the view the reader chose. */
export function LibraryBooks({ saved, shelves, recent }: { saved: View; shelves: Shelf[]; recent: ShelfBook[] }) {
  return useView(saved) === "shelf" ? <ShelfView shelves={shelves} recent={recent} /> : <BookList shelves={shelves} recent={recent} />;
}
