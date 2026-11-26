import "katex/dist/katex.min.css";
import type { Element } from "hast";
import { createContext, memo, useContext, type ElementType, type JSX } from "react";
import ReactMarkdown, { type Components, type ExtraProps, type Options } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { citedNumber } from "@/lib/shared/quotes";
import { BOARD_FENCE } from "@/lib/shared/boards";
import { AnswerBoard, BoardChanges, BoardChangesWriting } from "./BoardChanges";
import { Diagram } from "./Diagram";
import { CitationLink } from "./Quotes";
import { settledStarts } from "./settled";

type Tag = keyof JSX.IntrinsicElements;

/* Whether these blocks are the part of a streaming answer still being written. Marked in the DOM rather than by
   a different set of components, so a block keeps its node when it settles and doesn't fade in a second time. */
const Live = createContext(false);

/** A Markdown element rendered as `tag` with fixed classes. The syntax-tree `node` prop never reaches the DOM. */
const styled = <T extends Tag>(tag: T, className: string, extra?: JSX.IntrinsicElements[T]) =>
  function Styled({ node, ...props }: JSX.IntrinsicElements[T] & ExtraProps) {
    void node;
    const live = useContext(Live);
    const Element = tag as ElementType;
    return <Element {...extra} {...props} data-live={live ? "" : undefined} className={className} />;
  };

const preClass =
  "my-2 overflow-x-auto rounded-md bg-ink/70 px-3 py-2.5 font-mono text-code text-fog [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-fog";
const StyledPre = styled("pre", preClass);

/** The source of a fenced block in `language`, which the highlighter leaves as one plain text node; null for any other block. */
const fenceSource = (node: Element | undefined, language: string): string | null => {
  const code = node?.children[0];
  if (code?.type !== "element" || code.tagName !== "code") return null;
  const classes = code.properties.className;
  if (!Array.isArray(classes) || !classes.includes(`language-${language}`)) return null;
  return code.children.map((child) => (child.type === "text" ? child.value : "")).join("").replace(/\n$/, "");
};

/* A code block, or a diagram once its fence has closed: while the part being written is still arriving it stays
   code. The tutor's board changes are never shown as their JSON: they are a card, writing while they arrive. */
function Pre(props: JSX.IntrinsicElements["pre"] & ExtraProps) {
  const live = useContext(Live);
  const changes = useContext(AnswerBoard);
  if (fenceSource(props.node, BOARD_FENCE) !== null) {
    if (live) return <BoardChangesWriting />;
    /* Only the last fence is the answer's changes; an earlier one, superseded, shows as nothing rather than a second card. */
    const at = props.node?.position?.start.offset;
    return changes && at !== undefined && at !== changes.fenceAt ? null : <BoardChanges />;
  }
  const source = live ? null : fenceSource(props.node, "mermaid");
  return source === null ? <StyledPre {...props} /> : <Diagram source={source} codeClass={preClass} />;
}

const StyledLink = styled("a", "text-paper underline decoration-dim underline-offset-2 transition-colors hover:decoration-paper", {
  target: "_blank",
  rel: "noreferrer noopener",
});

/* A link to "#cite-N" is the tutor citing a passage the reader quoted; any other opens in the browser. */
function Link(props: JSX.IntrinsicElements["a"] & ExtraProps) {
  const number = citedNumber(props.href);
  return number === null ? <StyledLink {...props} /> : <CitationLink number={number}>{props.children}</CitationLink>;
}

/* Raw HTML in a reply stays text (no rehype-raw), and react-markdown drops unsafe link protocols. */
const components: Components = {
  p: styled("p", "my-2 first:mt-0 last:mb-0"),
  h1: styled("h3", "mb-1.5 mt-4 text-callout font-semibold text-paper first:mt-0"),
  h2: styled("h3", "mb-1.5 mt-4 text-body font-semibold text-paper first:mt-0"),
  h3: styled("h4", "mb-1 mt-3 text-body font-semibold text-paper first:mt-0"),
  h4: styled("h4", "mb-1 mt-3 text-body font-medium text-fog first:mt-0"),
  ul: styled("ul", "my-2 list-disc space-y-1 pl-4 marker:text-dim"),
  ol: styled("ol", "my-2 list-decimal space-y-1 pl-5 marker:text-dim"),
  li: styled("li", "pl-0.5"),
  strong: styled("strong", "font-semibold text-paper"),
  a: Link,
  blockquote: styled("blockquote", "my-2 border-l-2 border-line-strong pl-3 text-fog"),
  hr: styled("hr", "my-4 border-line"),
  pre: Pre,
  code: styled("code", "rounded-xs bg-tint px-1 py-px font-mono text-code text-paper"),
  table: styled("table", "my-2 block w-full overflow-x-auto border-collapse text-label"),
  th: styled("th", "border-b border-line-strong px-2 py-1.5 text-left font-medium text-fog"),
  td: styled("td", "border-b border-line px-2 py-1.5 align-top"),
};

/* Math only between double dollars, so prices in a reply ("$5 and $10") stay text. Code is highlighted only when its
   fence names a language; Mermaid is left for the diagram. */
const remarkPlugins: Options["remarkPlugins"] = [remarkGfm, [remarkMath, { singleDollarTextMath: false }]];
const rehypePlugins: Options["rehypePlugins"] = [rehypeKatex, [rehypeHighlight, { detect: false, plainText: ["mermaid", BOARD_FENCE] }]];

/* The blocks alone, with no wrapper, so a streaming answer's two parts sit in one box and keep its spacing rules. */
const Blocks = memo(function Blocks({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
      {text}
    </ReactMarkdown>
  );
});

const boxClass = "min-w-0 break-words text-body text-paper";

/** An assistant reply or a note: plain body text, no bubble. Memoised so a streaming answer doesn't re-parse earlier messages. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className={boxClass}>
      <Blocks text={text} />
    </div>
  );
});

/**
 * An answer still arriving. Each finished block group is parsed once, keyed by where it starts; only the part
 * being written is parsed again per update. The part being written is keyed by its own start, so when it
 * settles it keeps its nodes, and only blocks that arrive already finished fade in.
 */
export function StreamingMarkdown({ text }: { text: string }) {
  const starts = [0, ...settledStarts(text)];
  return (
    <div className={`${boxClass} settle-fade`}>
      {starts.map((start, i) => {
        const tail = i === starts.length - 1;
        return (
          <Live key={start} value={tail}>
            <Blocks text={text.slice(start, tail ? undefined : starts[i + 1])} />
          </Live>
        );
      })}
    </div>
  );
}
