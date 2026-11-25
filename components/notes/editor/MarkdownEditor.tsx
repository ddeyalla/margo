"use client";

import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { Annotation, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderText, type Command } from "@codemirror/view";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { noteCompletions } from "./completions";
import { hostFacet, type EditorHost } from "./host";
import { linkClicks, livePreview } from "./livePreview";
import { codeHighlighting, editorTheme } from "./theme";

export interface MarkdownEditorHandle {
  /** Replaces the whole text, such as with a version read from disk, without reporting it as an edit. */
  setText(text: string): void;
  getText(): string;
  focus(): void;
}

/** Marks a change that came from outside the editor, so it isn't reported back as the reader's edit. */
const external = Annotation.define<boolean>();

/** Wraps the selection in `marker`, or takes it off when it is already wrapped. */
const wrap =
  (marker: string): Command =>
  (view) => {
    view.dispatch(
      view.state.changeByRange((range) => {
        const n = marker.length;
        const before = view.state.sliceDoc(range.from - n, range.from);
        const after = view.state.sliceDoc(range.to, range.to + n);
        if (before === marker && after === marker) {
          return {
            changes: [
              { from: range.from - n, to: range.from },
              { from: range.to, to: range.to + n },
            ],
            range: EditorSelection.range(range.from - n, range.to - n),
          };
        }
        return {
          changes: [
            { from: range.from, insert: marker },
            { from: range.to, insert: marker },
          ],
          range: EditorSelection.range(range.from + n, range.to + n),
        };
      }),
    );
    return true;
  };

/** Saves pasted or dropped images through the host and inserts their links where they landed. */
const images = EditorView.domEventHandlers({
  paste(event, view) {
    const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/"));
    return insertImages(view, files, view.state.selection.main.from, event);
  },
  drop(event, view) {
    const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith("image/"));
    const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.from;
    return insertImages(view, files, at, event);
  },
});

const insertImages = (view: EditorView, files: File[], at: number, event: Event) => {
  const save = view.state.facet(hostFacet)().saveImage;
  if (!files.length || !save) return false;
  event.preventDefault();
  void (async () => {
    for (const file of files) {
      const link = await save(file);
      if (!link) continue;
      const pos = Math.min(at, view.state.doc.length);
      const lineStart = view.state.doc.lineAt(pos).from === pos;
      const insert = `${lineStart ? "" : "\n"}${link}\n`;
      view.dispatch({ changes: { from: pos, insert }, selection: EditorSelection.cursor(pos + insert.length), userEvent: "input.paste" });
      at = pos + insert.length;
    }
  })();
  return true;
};

/**
 * A live-preview Markdown editor (CodeMirror 6): formatting shows inline and the raw syntax shows on the line
 * being edited. Uncontrolled: it starts from `initialText` and reports every edit through `onChange`.
 */
export function MarkdownEditor({
  initialText,
  onChange,
  host,
  placeholder,
  compact = false,
  autoFocus = false,
  maxLength,
  label,
  className,
  handle,
}: {
  initialText: string;
  onChange(text: string): void;
  host: EditorHost;
  placeholder?: string;
  compact?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  label: string;
  className?: string;
  handle?: Ref<MarkdownEditorHandle>;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const hostRef = useRef(host);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    hostRef.current = host;
    onChangeRef.current = onChange;
  });

  /* Built once: the text, host and callbacks are read through refs, so the editor never restarts under the caret. */
  const startRef = useRef({ initialText, placeholder, compact, autoFocus, maxLength, label });
  useEffect(() => {
    const start = startRef.current;
    const extensions: Extension[] = [
      hostFacet.of(() => hostRef.current),
      history(),
      closeBrackets(),
      EditorState.languageData.of(() => [{ closeBrackets: { brackets: ["(", "[", "{"] } }]),
      keymap.of([
        { key: "Mod-Enter", run: () => (hostRef.current.onSubmit ? (hostRef.current.onSubmit(), true) : false) },
        { key: "Escape", run: () => (hostRef.current.onEscape ? (hostRef.current.onEscape(), true) : false) },
        { key: "Mod-b", run: wrap("**") },
        { key: "Mod-i", run: wrap("*") },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-label": start.label, spellcheck: "true", autocorrect: "on" }),
      livePreview,
      linkClicks,
      images,
      noteCompletions,
      codeHighlighting,
      editorTheme(start.compact),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !update.transactions.some((tr) => tr.annotation(external))) onChangeRef.current(update.state.doc.toString());
      }),
    ];
    if (start.placeholder) extensions.push(placeholderText(start.placeholder));
    if (start.maxLength) {
      const max = start.maxLength;
      extensions.push(EditorState.transactionFilter.of((tr) => (tr.docChanged && tr.newDoc.length > max && !tr.annotation(external) ? [] : tr)));
    }
    const view = new EditorView({
      parent: parentRef.current!,
      state: EditorState.create({
        doc: start.initialText,
        selection: EditorSelection.cursor(start.autoFocus ? start.initialText.length : 0),
        extensions,
      }),
    });
    viewRef.current = view;
    if (start.autoFocus) view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useImperativeHandle(
    handle,
    () => ({
      setText(text) {
        const view = viewRef.current;
        if (!view || view.state.doc.toString() === text) return;
        const head = Math.min(view.state.selection.main.head, text.length);
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: EditorSelection.cursor(head), annotations: external.of(true) });
      },
      getText: () => viewRef.current?.state.doc.toString() ?? "",
      focus: () => viewRef.current?.focus(),
    }),
    [],
  );

  return <div ref={parentRef} className={className} />;
}
