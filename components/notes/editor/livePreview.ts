import { syntaxTree } from "@codemirror/language";
import { EditorState, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet, type WidgetType } from "@codemirror/view";
import { parseWikiLinks, withoutCode } from "@/lib/shared/wikilinks";
import { hostFacet } from "./host";
import { BulletWidget, CheckboxWidget, EmbedWidget, ImageWidget, MathWidget, RuleWidget } from "./widgets";

/* Live preview: Markdown shows formatted, and the raw syntax comes back on the lines the caret or selection is on.
   Built in a state field rather than a view plugin, because math blocks and embeds replace whole lines. */

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const hide = Decoration.replace({});
const mark = (className: string, attributes?: Record<string, string>) => Decoration.mark({ class: className, attributes });
const line = (className: string) => Decoration.line({ class: className });

const build = (state: EditorState): DecorationSet => {
  const host = state.facet(hostFacet)();
  const doc = state.doc;
  const ranges: Range<Decoration>[] = [];
  /* Text a construct already drew, so a [[link]] is not also read as a Markdown link, or math as a tag. */
  const claimed: [number, number][] = [];
  const isClaimed = (from: number, to: number) => claimed.some(([a, b]) => from < b && to > a);
  const claim = (from: number, to: number) => claimed.push([from, to]);

  /** The caret or selection touches one of the lines from `from` to `to`, so their syntax shows. */
  const active = (from: number, to = from) => {
    const start = doc.lineAt(from).from;
    const end = doc.lineAt(to).to;
    return state.selection.ranges.some((r) => r.from <= end && r.to >= start);
  };
  const aloneOnLine = (from: number, to: number) => {
    const at = doc.lineAt(from);
    return to <= at.to && !at.text.slice(0, from - at.from).trim() && !at.text.slice(to - at.from).trim();
  };
  /** Replaces `from`..`to` with a widget: a block of its own, covering the whole line, when nothing else is on it. */
  const widget = (widget: WidgetType, from: number, to: number) => {
    if (!aloneOnLine(from, to)) return ranges.push(Decoration.replace({ widget }).range(from, to));
    const at = doc.lineAt(from);
    ranges.push(Decoration.replace({ widget, block: true }).range(at.from, at.to));
  };

  const text = doc.toString();
  const prose = withoutCode(text);

  /* Math between double dollars: a block of lines, a line of its own, or inline. */
  for (const match of prose.matchAll(/^\$\$[ \t]*\n([\s\S]*?)\n\$\$[ \t]*$/gm)) {
    const from = match.index;
    const to = from + match[0].length;
    claim(from, to);
    if (!active(from, to)) ranges.push(Decoration.replace({ widget: new MathWidget(match[1], true), block: true }).range(from, to));
  }
  for (const match of prose.matchAll(/\$\$([^\n$]+?)\$\$/g)) {
    const from = match.index;
    const to = from + match[0].length;
    if (isClaimed(from, to)) continue;
    claim(from, to);
    if (active(from)) continue;
    widget(new MathWidget(text.slice(from + 2, to - 2).trim(), aloneOnLine(from, to)), from, to);
  }

  /* [[links]] and ![[embeds]]: a note's text, a highlight by its block id, or an image. */
  for (const link of parseWikiLinks(text)) {
    if (isClaimed(link.from, link.to)) continue;
    claim(link.from, link.to);
    const raw = text.slice(link.from, link.to);
    const on = active(link.from);
    if (link.embed && !on) {
      if (IMAGE.test(link.target)) {
        const src = host.imageUrl?.(link.target);
        if (src) widget(new ImageWidget(src, link.alias ?? link.target), link.from, link.to);
      } else if (host.embed) {
        widget(new EmbedWidget(link.target, link.subpath, host.notePath ?? ""), link.from, link.to);
      }
      continue;
    }
    if (link.embed) continue;
    const inner = raw.slice(2, -2);
    const shownFrom = link.alias ? link.from + 2 + inner.lastIndexOf("|") + 1 : link.from + 2;
    const shownTo = link.to - 2;
    const exists = host.linkExists?.(link.target) ?? true;
    const attributes = { "data-wikilink": link.target, "data-subpath": link.subpath ?? "", "data-open": on ? "mod" : "click" };
    if (on) {
      ranges.push(mark(`cm-wikilink${exists ? "" : " cm-wikilink-missing"}`, attributes).range(link.from, link.to));
    } else if (shownTo > shownFrom) {
      ranges.push(hide.range(link.from, shownFrom));
      ranges.push(mark(`cm-wikilink${exists ? "" : " cm-wikilink-missing"}`, attributes).range(shownFrom, shownTo));
      ranges.push(hide.range(shownTo, link.to));
    }
  }

  /* #tags, read as parseTags reads them. */
  for (const match of prose.matchAll(/(^|\s)(#[\p{L}\p{N}_/-]+)/gu)) {
    const from = match.index + match[1].length;
    const tag = match[2].replace(/[/-]+$/, "");
    const to = from + tag.length;
    if (/\D/.test(tag.slice(1)) && !isClaimed(from, to)) ranges.push(mark("cm-tag").range(from, to));
  }

  syntaxTree(state).iterate({
    enter(node) {
      const { name, from, to } = node;
      if (isClaimed(from, to) && name !== "Document" && name !== "Paragraph") {
        /* Inside math or a wikilink: drawn already. Block nodes that merely contain them still get their styling. */
        if (!/^(ATXHeading|Blockquote|BulletList|OrderedList|ListItem|Task)/.test(name)) return false;
      }
      const heading = /^ATXHeading(\d)$/.exec(name) ?? /^SetextHeading(\d)$/.exec(name);
      if (heading) {
        ranges.push(line(`cm-h${heading[1]}`).range(doc.lineAt(from).from));
        return;
      }
      switch (name) {
        case "HeaderMark": {
          if (node.node.parent?.name.startsWith("Setext") || active(from)) return;
          const end = doc.sliceString(to, to + 1) === " " ? to + 1 : to;
          ranges.push(hide.range(from, end));
          return;
        }
        case "EmphasisMark":
        case "StrikethroughMark":
          if (!active(from)) ranges.push(hide.range(from, to));
          return;
        case "InlineCode":
          ranges.push(mark("cm-inline-code").range(from, to));
          return;
        case "CodeMark":
          if (node.node.parent?.name === "InlineCode" && !active(from)) ranges.push(hide.range(from, to));
          return;
        case "FencedCode":
        case "CodeBlock": {
          const first = doc.lineAt(from).number;
          const last = doc.lineAt(to).number;
          for (let n = first; n <= last; n++) {
            const extra = `${n === first ? " cm-codeblock-first" : ""}${n === last ? " cm-codeblock-last" : ""}`;
            ranges.push(line(`cm-codeblock${extra}`).range(doc.line(n).from));
          }
          return false;
        }
        case "Blockquote": {
          for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) ranges.push(line("cm-quote").range(doc.line(n).from));
          return;
        }
        case "QuoteMark": {
          if (active(from)) return;
          const end = doc.sliceString(to, to + 1) === " " ? to + 1 : to;
          ranges.push(hide.range(from, end));
          return;
        }
        case "HorizontalRule":
          if (!active(from)) ranges.push(Decoration.replace({ widget: new RuleWidget() }).range(from, to));
          return;
        case "ListMark": {
          const item = node.node.parent;
          const task = item?.getChild("Task");
          const marker = task?.getChild("TaskMarker");
          if (task && marker) {
            const checked = /x/i.test(doc.sliceString(marker.from, marker.to));
            if (checked) ranges.push(mark("cm-task-done").range(marker.to, task.to));
            if (!active(from)) {
              const end = doc.sliceString(marker.to, marker.to + 1) === " " ? marker.to + 1 : marker.to;
              ranges.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(from, end));
            }
            return;
          }
          if (item?.parent?.name === "BulletList" && !active(from)) ranges.push(Decoration.replace({ widget: new BulletWidget() }).range(from, to));
          return;
        }
        case "Image": {
          if (active(from)) return false;
          const url = node.node.getChild("URL");
          const src = url ? doc.sliceString(url.from, url.to) : "";
          const resolved = /^https?:\/\//i.test(src) ? src : host.imageUrl?.(src);
          const alt = doc.sliceString(from, to).match(/^!\[([^\]]*)\]/)?.[1] ?? "";
          if (resolved) widget(new ImageWidget(resolved, alt), from, to);
          return false;
        }
        case "Link": {
          const marks = node.node.getChildren("LinkMark");
          const url = node.node.getChild("URL");
          if (marks.length < 2 || !url) return false;
          const textFrom = marks[0].to;
          const textTo = marks[1].from;
          const href = doc.sliceString(url.from, url.to);
          const on = active(from);
          ranges.push(mark("cm-md-link", { "data-href": href, "data-open": on ? "mod" : "click" }).range(textFrom, textTo));
          if (!on && textTo > textFrom) {
            ranges.push(hide.range(from, textFrom));
            ranges.push(hide.range(textTo, to));
          }
          return false;
        }
      }
    },
  });
  return Decoration.set(ranges, true);
};

export const livePreview = StateField.define<DecorationSet>({
  create: build,
  update(decorations, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState)) return build(tr.state);
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Follows a link on click when its line is shown formatted, and on ⌘-click while its syntax shows. */
export const linkClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-wikilink], [data-href]");
    if (!target || event.button !== 0) return false;
    if (target.dataset.open !== "click" && !(event.metaKey || event.ctrlKey)) return false;
    const host = view.state.facet(hostFacet)();
    if (target.dataset.href) {
      const href = target.dataset.href;
      if (!/^(https?|mailto):/i.test(href)) return false;
      event.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
      return true;
    }
    if (!host.openLink) return false;
    event.preventDefault();
    host.openLink(target.dataset.wikilink ?? "", target.dataset.subpath || null);
    return true;
  },
});
