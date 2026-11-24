import { Facet } from "@codemirror/state";
import type { Embed, HighlightBlock, NotesIndex } from "@/lib/shared/notes";

/** What the editor asks of the page around it. Everything is optional: a note on a highlight has no links to open. */
export interface EditorHost {
  /** The note being edited, relative to the notes folder; links and images resolve from here. */
  notePath?: string | null;
  /** The notes folder's notes, book files and tags, for completing links and tags. */
  index?(): NotesIndex | null;
  /** Highlights to embed, loaded when a "![[" completion first asks. */
  highlights?(): Promise<HighlightBlock[]>;
  /** Opens a [[link]]. */
  openLink?(target: string, subpath: string | null): void;
  /** Whether a link's target exists, so a missing one can look different. */
  linkExists?(target: string): boolean;
  /** The URL that shows an image the note links to. */
  imageUrl?(target: string): string | null;
  embed?(target: string, subpath: string | null): Promise<Embed | null>;
  /** Saves a pasted or dropped image and answers with the link to insert, or null when it can't. */
  saveImage?(file: File): Promise<string | null>;
  /** Opens a book from an embedded highlight. */
  openBook?(bookId: string): void;
  onSubmit?(): void;
  onEscape?(): void;
}

/** The host, read through a getter so the page can change what it answers without rebuilding the editor. */
export const hostFacet = Facet.define<() => EditorHost, () => EditorHost>({
  combine: (values) => values[0] ?? (() => ({})),
});
