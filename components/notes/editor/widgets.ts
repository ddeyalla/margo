import "katex/dist/katex.min.css";
import katex from "katex";
import { EditorView, WidgetType } from "@codemirror/view";
import type { Embed } from "@/lib/shared/notes";
import { hostFacet } from "./host";

/** A "- [ ]" item's box. Clicking it ticks or unticks the item in the text. */
export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-checkbox";
    box.checked = this.checked;
    box.setAttribute("aria-label", this.checked ? "Done" : "To do");
    box.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const line = view.state.doc.lineAt(view.posAtDOM(box));
      const at = line.text.search(/\[[ xX]\]/);
      if (at === -1) return;
      view.dispatch({ changes: { from: line.from + at + 1, to: line.from + at + 2, insert: this.checked ? " " : "x" } });
    });
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

export class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-bullet";
    dot.textContent = "•";
    return dot;
  }
}

export class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const rule = document.createElement("span");
    rule.className = "cm-hr";
    return rule;
  }
  ignoreEvent() {
    return false;
  }
}

/* Math between double dollars, as in chat (remark-math with single-dollar math off), drawn by KaTeX. Clicking it
   puts the caret there, which shows the source to edit. */
export class MathWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly display: boolean,
  ) {
    super();
  }
  eq(other: MathWidget) {
    return other.source === this.source && other.display === this.display;
  }
  toDOM() {
    const box = document.createElement(this.display ? "div" : "span");
    box.className = this.display ? "cm-math-block" : "cm-math-inline";
    try {
      box.innerHTML = katex.renderToString(this.source, { displayMode: this.display, throwOnError: true, output: "htmlAndMathml" });
    } catch {
      box.className += " cm-math-error";
      box.textContent = this.display ? `$$\n${this.source}\n$$` : `$$${this.source}$$`;
    }
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM() {
    const image = document.createElement("img");
    image.className = "cm-image";
    image.src = this.src;
    image.alt = this.alt;
    image.loading = "lazy";
    return image;
  }
  ignoreEvent() {
    return false;
  }
}

/* Embeds are fetched once per note and target; the editor redraws widgets far more often than files change. */
const embeds = new Map<string, Promise<Embed | null>>();

/** Forgets fetched embeds, so the next draw reads the files again. */
export const clearEmbedCache = () => embeds.clear();

/** ![[Note#^block]]: the block it names, such as a highlight from a book's file, with where it comes from. */
export class EmbedWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly subpath: string | null,
    readonly from: string,
  ) {
    super();
  }
  eq(other: EmbedWidget) {
    return other.target === this.target && other.subpath === this.subpath && other.from === this.from;
  }
  toDOM(view: EditorView) {
    const host = view.state.facet(hostFacet)();
    const box = document.createElement("div");
    box.className = "cm-embed";
    box.textContent = "…";
    const key = `${this.from}\n${this.target}\n${this.subpath ?? ""}`;
    let pending = embeds.get(key);
    if (!pending) {
      pending = host.embed?.(this.target, this.subpath).catch(() => null) ?? Promise.resolve(null);
      embeds.set(key, pending);
    }
    void pending.then((embed) => {
      if (!embed) {
        embeds.delete(key);
        box.textContent = `Nothing found for ${this.target}${this.subpath ? `#${this.subpath}` : ""}.`;
        box.style.fontFamily = "var(--font-sans)";
        box.style.color = "var(--color-dim)";
        return;
      }
      box.textContent = embed.text;
      const source = document.createElement("span");
      source.className = "cm-embed-source";
      const name = embed.path.replace(/\.md$/, "");
      const link = document.createElement("a");
      link.textContent = embed.bookId ? `${name}: open the book` : name;
      link.addEventListener("mousedown", (event) => {
        event.preventDefault();
        if (embed.bookId) host.openBook?.(embed.bookId);
        else host.openLink?.(this.target, this.subpath);
      });
      source.append(link);
      box.append(source);
    });
    return box;
  }
  ignoreEvent() {
    return false;
  }
}
