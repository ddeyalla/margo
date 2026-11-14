/** The block of text the spotlight keeps bright carries this attribute. */
const ON = "data-rl-on";
const STYLE_ID = "rl-spotlight";
const CLASS = "rl-spot";

/** Elements that read as one paragraph, narrowest first when they nest. */
const BLOCKS = "p, li, blockquote, dd, dt, h1, h2, h3, h4, h5, h6, pre, figure, figcaption, td, th, caption";

/** How far down the screen the reading line sits. */
export const READING_LINE = 0.33;

export interface SpotColors {
  prose: string;
  heading: string;
}

/**
 * Dims the book's text and leaves the marked block at full strength. Only colour changes, so the section is
 * never laid out again and the reader's place holds. Written to win over the reading styles, which set colours with !important.
 */
export const spotlightCss = ({ prose, heading }: SpotColors) => `
html.${CLASS} body, html.${CLASS} body * { color: color-mix(in srgb, ${prose} 26%, transparent) !important; transition: color 180ms ease-out; }
html.${CLASS} img, html.${CLASS} svg { opacity: 0.3; transition: opacity 180ms ease-out; }
html.${CLASS} [${ON}], html.${CLASS} [${ON}] * { color: ${prose} !important; }
html.${CLASS} [${ON}] :is(h1, h2, h3, h4, h5, h6, rl-fx), html.${CLASS} [${ON}]:is(h1, h2, h3, h4, h5, h6) { color: ${heading} !important; }
html.${CLASS} [${ON}] img, html.${CLASS} [${ON}] svg { opacity: 1; }
`;

/** Starts the spotlight in a section, or restyles it after a change of colours. */
export const installSpotlight = (doc: Document, colors: SpotColors) => {
  let style = doc.getElementById(STYLE_ID);
  if (!style) {
    style = doc.createElement("style");
    style.id = STYLE_ID;
    doc.head.append(style);
  }
  style.textContent = spotlightCss(colors);
  doc.documentElement.classList.add(CLASS);
};

export const removeSpotlight = (doc: Document) => {
  doc.getElementById(STYLE_ID)?.remove();
  doc.documentElement.classList.remove(CLASS);
  doc.querySelector(`[${ON}]`)?.removeAttribute(ON);
};

/** The paragraph at a point, trying a little below and above it when the point falls between paragraphs. */
export const blockAt = (doc: Document, x: number, y: number): Element | null => {
  for (const dy of [0, 10, 20, 32, -10, -20, -32]) {
    const hit = doc.elementFromPoint(x, y + dy);
    const block = hit?.closest(BLOCKS);
    if (block && doc.body.contains(block)) return block;
  }
  return null;
};

/** The block a node sits in, for a selection or a click. */
export const blockOf = (node: Node | null): Element | null => (node instanceof Element ? node : node?.parentElement)?.closest(BLOCKS) ?? null;

/** Marks one block as the bright one. */
export const markBlock = (doc: Document, block: Element | null) => {
  const current = doc.querySelector(`[${ON}]`);
  if (current === block) return;
  current?.removeAttribute(ON);
  block?.setAttribute(ON, "");
};
