import { autocompletion, startCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { linkTarget } from "@/lib/shared/wikilinks";
import { hostFacet } from "./host";

/* "/" commands at the start of a line or after a space, [[ links to notes, ![[ embeds of highlights, and #tags. */

/** Replaces what was typed with `before` + `after`, leaving the caret between them. */
const insert =
  (before: string, after = "", reopen = false) =>
  (view: EditorView, _completion: Completion, from: number, to: number) => {
    view.dispatch({
      changes: { from, to, insert: before + after },
      selection: EditorSelection.cursor(from + before.length),
      userEvent: "input.complete",
    });
    if (reopen) startCompletion(view);
  };

const COMMANDS: (Completion & { keywords: string })[] = [
  { label: "Heading 1", detail: "#", keywords: "h1 title", apply: insert("# ") },
  { label: "Heading 2", detail: "##", keywords: "h2 subtitle", apply: insert("## ") },
  { label: "Heading 3", detail: "###", keywords: "h3", apply: insert("### ") },
  { label: "Checklist", detail: "- [ ]", keywords: "todo task checkbox", apply: insert("- [ ] ") },
  { label: "Bulleted list", detail: "-", keywords: "ul bullet", apply: insert("- ") },
  { label: "Numbered list", detail: "1.", keywords: "ol ordered", apply: insert("1. ") },
  { label: "Quote", detail: ">", keywords: "blockquote", apply: insert("> ") },
  { label: "Code block", detail: "```", keywords: "pre snippet", apply: insert("```\n", "\n```") },
  { label: "Math block", detail: "$$", keywords: "katex latex equation formula", apply: insert("$$\n", "\n$$") },
  { label: "Table", detail: "| |", keywords: "grid", apply: insert("| Column | Column |\n| --- | --- |\n| ", " |  |") },
  { label: "Divider", detail: "---", keywords: "hr rule line separator", apply: insert("---\n") },
  { label: "Link to a note", detail: "[[", keywords: "wikilink page", apply: insert("[[", "", true) },
  { label: "Embed a highlight", detail: "![[", keywords: "quote passage book block", apply: insert("![[", "", true) },
];

const commands = (context: CompletionContext): CompletionResult | null => {
  const typed = context.matchBefore(/(?:^|\s)\/[\w ]{0,20}$/);
  if (!typed) return null;
  const from = typed.from + (typed.text.startsWith("/") ? 0 : 1);
  const query = context.state.sliceDoc(from + 1, context.pos).toLowerCase().trim();
  const options = COMMANDS.filter((c) => !query || `${c.label} ${c.keywords}`.toLowerCase().includes(query));
  if (!options.length) return null;
  return { from, to: context.pos, options, filter: false };
};

/** Text after the caret that a completion would otherwise duplicate, such as the "]]" closeBrackets added. */
const closing = (context: CompletionContext) => (context.state.sliceDoc(context.pos, context.pos + 2) === "]]" ? "" : "]]");

const links = async (context: CompletionContext): Promise<CompletionResult | null> => {
  const typed = context.matchBefore(/!?\[\[[^\]\n|]*$/);
  if (!typed) return null;
  const host = context.state.facet(hostFacet)();
  const index = host.index?.();
  const embed = typed.text.startsWith("!");
  const from = typed.from + (embed ? 3 : 2);
  const end = closing(context);
  const paths = index ? [...index.notes, ...index.books].map((n) => n.path) : [];
  const options: Completion[] = [];
  if (embed && host.highlights) {
    for (const block of await host.highlights().catch(() => [])) {
      options.push({ label: block.quote.replace(/\s+/g, " ").slice(0, 90), detail: block.bookTitle, info: block.quote, apply: `${block.target}${end}`, type: "highlight", boost: 2 });
    }
  }
  for (const note of index?.notes ?? []) {
    if (note.path === host.notePath) continue;
    options.push({ label: linkTarget(note.path, paths), detail: note.path.includes("/") ? note.path.replace(/\/[^/]+$/, "") : undefined, apply: `${linkTarget(note.path, paths)}${end}`, boost: embed ? 0 : 1 });
  }
  for (const book of index?.books ?? []) options.push({ label: linkTarget(book.path, paths), detail: "book", apply: `${linkTarget(book.path, paths)}${end}` });
  return options.length ? { from, options, validFor: /^[^\]\n|]*$/ } : null;
};

const tags = (context: CompletionContext): CompletionResult | null => {
  const typed = context.matchBefore(/(?:^|\s)#[\p{L}\p{N}_/-]+$/u);
  if (!typed) return null;
  const known = context.state.facet(hostFacet)().index?.()?.tags ?? [];
  if (!known.length) return null;
  const from = typed.from + typed.text.indexOf("#") + 1;
  return { from, options: known.map((tag) => ({ label: tag, type: "tag" })), validFor: /^[\p{L}\p{N}_/-]*$/u };
};

export const noteCompletions = autocompletion({
  override: [commands, links, tags],
  icons: false,
  activateOnTyping: true,
  closeOnBlur: true,
});
