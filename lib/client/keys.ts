/** Typing here keeps its own keys, such as Esc in the note editor or ⌘⇧H in a question. */
export const isTextEntry = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"));
