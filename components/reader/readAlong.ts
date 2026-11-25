import { localVoices, Narrator, pickVoice, type FoliateTTS } from "./narrator";
import { blockOf, litBlock, markBlock } from "./spotlight";

/** The word being read is painted with this CSS highlight, in the section's own window. */
export const READ_ALONG = "rl-read";
/** In Scroll mode, the read-along controls cover this much of the bottom of the book. */
const CONTROLS_CLEARANCE = 72;

/** The parts of foliate's view read-along drives. */
export interface ReadAlongView {
  book: { sections: { linear?: string }[] };
  lastLocation: { range?: Range } | null;
  renderer: { nextSection(): Promise<void>; scrollToAnchor(anchor: Range, select?: boolean): Promise<void> };
  /** The open section's TTS, made by `initTTS` and made again only for a new section. */
  tts: FoliateTTS | null;
  initTTS(granularity: "word" | "sentence", highlight: (range: Range) => void): Promise<void>;
}

export interface ReadAlongEnv {
  /** The view, once the book is open. */
  view(): ReadAlongView | null;
  section(): { doc: Document; index: number } | null;
  /** The box the book is shown in. */
  host(): HTMLElement | null;
  paged(): boolean;
  spotlight(): boolean;
  /** The paragraph at the spotlight's reading line. */
  blockAtReadingLine(doc: Document): Element | null;
  /** Reading stopped by itself: the book ended, the voice failed, or the reader moved away. */
  stopped(): void;
}

const windowOf = (range: Range | null) => range?.startContainer.ownerDocument?.defaultView as (Window & typeof globalThis) | null | undefined;

/**
 * Read-along for one open book: a Narrator speaking foliate's TTS, with the word being read lit on the page,
 * the page turned when that word leaves the view, and the spotlight kept on its paragraph.
 */
export class ReadAlong {
  #env: ReadAlongEnv;
  #narrator: Narrator;
  /* The word lit last, so playing again goes on from it while it is still on screen. */
  #word: Range | null = null;
  /* The narrator is turning to the next section, so that section's load is not the reader moving by hand. */
  #advancing = false;
  /** A voice is reading now. */
  reading = false;

  constructor(env: ReadAlongEnv) {
    this.#env = env;
    this.#narrator = new Narrator({
      tts: async () => {
        const view = env.view();
        if (!view) return null;
        await view.initTTS("word", (range) => this.#show(range));
        return view.tts;
      },
      nextSection: async () => {
        const view = env.view();
        const section = env.section();
        if (!view || !section || !view.book.sections.slice(section.index + 1).some((s) => s.linear !== "no")) return false;
        this.#advancing = true;
        try {
          await view.renderer.nextSection();
        } finally {
          this.#advancing = false;
        }
        return true;
      },
      stopped: () => {
        this.reading = false;
        env.stopped();
      },
    });
  }

  /** Starts, or goes on from the last word, at this speed and in this voice (a voiceURI, or null for the default). */
  play(rate: number, voice: string | null) {
    const section = this.#env.section();
    if (!this.#env.view() || !section) return;
    this.#narrator.rate = rate;
    this.#narrator.voice = pickVoice(localVoices(), voice, section.doc.documentElement.lang || navigator.language);
    this.reading = true;
    void this.#narrator.play(this.#startFrom(section.doc));
  }

  /** Stops the voice and leaves the word lit. */
  pause() {
    this.reading = false;
    this.#narrator.pause();
  }

  /** The reader moved away by hand: the voice stops, and says so. */
  interrupt() {
    if (!this.reading) return;
    this.pause();
    this.#env.stopped();
  }

  /** Read-along closed, or the page is going: silence, and no word lit. */
  close() {
    this.pause();
    windowOf(this.#word)?.CSS.highlights?.delete(READ_ALONG);
    this.#word = null;
  }

  /** The section's text changed under foliate's TTS, as bold starts does: its words are found again from the page. */
  forget() {
    this.interrupt();
    this.close();
    const view = this.#env.view();
    if (view) view.tts = null;
  }

  /** A section loaded. Unless the narrator turned to it, the reader changed chapter by hand. */
  sectionLoaded() {
    if (!this.#advancing) this.interrupt();
  }

  /** The paragraph being read, for the spotlight to stay on. */
  block(): Element | null {
    return this.reading && this.#word ? blockOf(this.#word.startContainer) : null;
  }

  /* foliate calls this with each word the voice reaches. */
  #show(range: Range) {
    const doc = range.startContainer.ownerDocument;
    const win = windowOf(range);
    if (!doc || !win) return;
    this.#word = range;
    win.CSS.highlights?.set(READ_ALONG, new win.Highlight(range));
    if (this.#env.spotlight()) markBlock(doc, blockOf(range.startContainer));
    if (!this.#onScreen(range)) void this.#env.view()?.renderer.scrollToAnchor(range);
  }

  /* Whether a word is in view, clear of the read-along controls in Scroll mode. A Pages-mode page is never
     cut short, or a word near its foot would turn to the same page over and over. */
  #onScreen(range: Range) {
    const host = this.#env.host();
    const frame = range.startContainer.ownerDocument?.defaultView?.frameElement;
    const rect = Array.from(range.getClientRects()).find((r) => r.width > 0 && r.height > 0);
    if (!host || !frame || !rect) return false;
    const area = host.getBoundingClientRect();
    const box = frame.getBoundingClientRect();
    const bottom = area.bottom - (this.#env.paged() ? 0 : CONTROLS_CLEARANCE);
    return box.top + rect.top >= area.top && box.top + rect.bottom <= bottom && box.left + rect.left >= area.left && box.left + rect.right <= area.right;
  }

  /* Where to start: the last word read while it is still in view (null), else the paragraph in view from its
     first word on screen. The spotlight's paragraph counts as the one in view. */
  #startFrom(doc: Document): Range | null {
    const word = this.#word;
    if (word && word.startContainer.ownerDocument === doc && this.#onScreen(word)) return null;
    const visible = this.#env.view()?.lastLocation?.range;
    const shown = visible && visible.startContainer.ownerDocument === doc ? visible : null;
    const block = (this.#env.spotlight() ? litBlock(doc) : null) ?? this.#env.blockAtReadingLine(doc);
    if (!block) return shown?.cloneRange() ?? doc.createRange();
    const range = doc.createRange();
    range.selectNodeContents(block);
    /* A paragraph that began on the page before starts from its first word on this one. */
    if (shown && range.comparePoint(shown.startContainer, shown.startOffset) === 0) {
      range.setStart(shown.startContainer, shown.startOffset);
    }
    return range;
  }
}
