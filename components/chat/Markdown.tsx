import { memo, type ElementType, type JSX } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";

type Tag = keyof JSX.IntrinsicElements;

/** A Markdown element rendered as `tag` with fixed classes. The syntax-tree `node` prop never reaches the DOM. */
const styled = <T extends Tag>(tag: T, className: string, extra?: JSX.IntrinsicElements[T]) =>
  function Styled({ node, ...props }: JSX.IntrinsicElements[T] & ExtraProps) {
    void node;
    const Element = tag as ElementType;
    return <Element {...extra} {...props} className={className} />;
  };

/* Raw HTML in a reply stays text (no rehype-raw), and react-markdown drops unsafe link protocols. */
const components: Components = {
  p: styled("p", "my-2 first:mt-0 last:mb-0"),
  h1: styled("h3", "mb-1.5 mt-4 text-[14px] font-semibold text-paper first:mt-0"),
  h2: styled("h3", "mb-1.5 mt-4 text-[13px] font-semibold text-paper first:mt-0"),
  h3: styled("h4", "mb-1 mt-3 text-[13px] font-semibold text-paper first:mt-0"),
  h4: styled("h4", "mb-1 mt-3 text-[13px] font-medium text-fog first:mt-0"),
  ul: styled("ul", "my-2 list-disc space-y-1 pl-4 marker:text-dim"),
  ol: styled("ol", "my-2 list-decimal space-y-1 pl-5 marker:text-dim"),
  li: styled("li", "pl-0.5"),
  strong: styled("strong", "font-semibold text-paper"),
  a: styled("a", "text-paper underline decoration-dim underline-offset-2 transition-colors hover:decoration-paper", {
    target: "_blank",
    rel: "noreferrer noopener",
  }),
  blockquote: styled("blockquote", "my-2 border-l-2 border-line-strong pl-3 text-fog"),
  hr: styled("hr", "my-4 border-line"),
  pre: styled("pre", "my-2 overflow-x-auto rounded-md bg-ink/70 px-3 py-2.5 font-mono text-code text-fog [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-fog"),
  code: styled("code", "rounded-xs bg-white/[0.06] px-1 py-px font-mono text-code text-paper"),
  table: styled("table", "my-2 block w-full overflow-x-auto border-collapse text-label"),
  th: styled("th", "border-b border-line-strong px-2 py-1.5 text-left font-medium text-fog"),
  td: styled("td", "border-b border-line px-2 py-1.5 align-top"),
};

/** An assistant reply or a note: plain body text, no bubble. Memoised so a streaming answer doesn't re-parse earlier messages. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="min-w-0 break-words text-body text-paper">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
