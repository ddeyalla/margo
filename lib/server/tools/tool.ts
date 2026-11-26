import type { BookState } from "@/lib/shared/types";
import { findBook, type FoundBook } from "../library";
import { readBookState } from "../store";
import { parseInput, ToolError, type Fields, type InputOf } from "./schema";

/** Who is calling and when: the app itself, or an outside agent by the name it gave. */
export interface ToolContext {
  caller: string;
  now: Date;
}

/**
 * One capability of the app, as both its routes and outside agents call it. `effect` says what a call may change:
 * nothing, the reader's own data directly, or only the suggestions inbox, where the reader decides.
 */
export interface Tool<S extends Fields = Fields, O = unknown> {
  name: string;
  description: string;
  effect: "read" | "write" | "propose";
  input: S;
  run(input: InputOf<S>, context: ToolContext): Promise<O>;
}

export const defineTool = <S extends Fields, O>(tool: Tool<S, O>): Tool<S, O> => tool;

/** Checks the arguments against the tool's fields, then runs it. Throws `ToolError` for anything the caller can fix. */
export const runTool = <S extends Fields, O>(tool: Tool<S, O>, raw: unknown, context: ToolContext): Promise<O> =>
  Promise.resolve().then(() => tool.run(parseInput(tool.input, raw), context));

export const BOOK_ID = { type: "string", max: 40, description: "The book's id, as list_library gives it." } as const;

/** The book by id, or a `ToolError` an agent can act on. */
export const requireBook = async (id: string): Promise<FoundBook> => {
  const found = await findBook(id);
  if (!found) throw new ToolError("No book in the library has that id. Call list_library for the ids.");
  return found;
};

export const titleOf = (state: BookState | null, fileTitle: string) => state?.meta?.title || fileTitle;

/** The book and what the reader saved for it. */
export const requireBookState = async (id: string) => {
  const { book } = await requireBook(id);
  const state = await readBookState(book.id);
  return { book, state, title: titleOf(state, book.fileTitle) };
};

/** Text cut to `max` characters, with an ellipsis when something was left out. */
export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
