import { markAt, ssmlToText } from "./ssml";

/** foliate's TTS for one section (tts.js). Each call returns the SSML of a block, or undefined past the end. */
export interface FoliateTTS {
  doc: Document;
  start(): string | undefined;
  resume(): string | undefined;
  next(): string | undefined;
  from(range: Range): string | undefined;
  /** Hands the word's Range to the highlight callback given when the TTS was made. */
  setMark(mark: string): void;
}

/** The on-device voices, the only ones read-along uses: their audio never leaves this machine. */
export const localVoices = (): SpeechSynthesisVoice[] =>
  typeof speechSynthesis === "undefined" ? [] : speechSynthesis.getVoices().filter((voice) => voice.localService);

/**
 * The on-device voices once the browser has listed them. Chromium lists none until it has asked the system,
 * then fires voiceschanged; a machine with no voices never fires it, so the wait gives up after `timeoutMs`.
 */
export const loadLocalVoices = (timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> => {
  if (typeof speechSynthesis === "undefined") return Promise.resolve([]);
  if (speechSynthesis.getVoices().length) return Promise.resolve(localVoices());
  return new Promise((resolve) => {
    const done = () => {
      speechSynthesis.removeEventListener("voiceschanged", done);
      clearTimeout(timer);
      resolve(localVoices());
    };
    const timer = setTimeout(done, timeoutMs);
    speechSynthesis.addEventListener("voiceschanged", done);
  });
};

/** The voice for a saved voiceURI, else this machine's default on-device voice for the language, else any. */
export const pickVoice = (voices: SpeechSynthesisVoice[], uri: string | null, lang: string): SpeechSynthesisVoice | null => {
  const saved = uri ? voices.find((voice) => voice.voiceURI === uri) : undefined;
  if (saved) return saved;
  const base = lang.toLowerCase().split("-")[0];
  const fits = voices.filter((voice) => voice.lang.toLowerCase().split("-")[0] === base);
  return fits.find((voice) => voice.default) ?? fits.find((voice) => voice.lang.toLowerCase() === lang.toLowerCase()) ?? fits[0] ?? voices.find((voice) => voice.default) ?? voices[0] ?? null;
};

export interface NarratorHooks {
  /** The TTS for the section on screen, made if needed. */
  tts(): Promise<FoliateTTS | null>;
  /** Turns to the next section; false when the book has none. */
  nextSection(): Promise<boolean>;
  /** Reading stopped on its own: the book ended, or the voice failed. */
  stopped(reason: "end" | "error"): void;
}

/**
 * Speaks a book a block at a time through the browser's speech voices and moves foliate's mark with each word.
 * Pausing cancels the voice and playing again resumes at the last word, since a paused utterance is unreliable
 * in Chromium. Every utterance carries a generation, so the end or error a cancel fires on an old one is ignored.
 */
export class Narrator {
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  #hooks: NarratorHooks;
  #generation = 0;
  /* Held so the utterance isn't collected mid-speech, which would lose its end event. */
  #utterance: SpeechSynthesisUtterance | null = null;

  constructor(hooks: NarratorHooks) {
    this.#hooks = hooks;
  }

  /** Starts at `from`, or at the last word read when null. */
  async play(from: Range | null) {
    const generation = this.#silence();
    const tts = await this.#tts();
    if (generation !== this.#generation) return;
    if (!tts) return this.#fail();
    let ssml: string | undefined;
    try {
      ssml = from ? tts.from(from) : tts.resume();
    } catch {
      /* foliate's `from` throws when the range lies past the section's last block. */
      ssml = tts.start();
    }
    this.#speak(tts, ssml, generation);
  }

  /** Stops the voice; the last word stays marked, and `play(null)` goes on from it. */
  pause() {
    this.#silence();
  }

  #silence() {
    this.#generation += 1;
    this.#utterance = null;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    return this.#generation;
  }

  /* A TTS that could not be made, the import of foliate's tts.js failing for one, is the same as none. */
  async #tts() {
    try {
      return await this.#hooks.tts();
    } catch {
      return null;
    }
  }

  #fail() {
    this.#silence();
    this.#hooks.stopped("error");
  }

  #speak(tts: FoliateTTS, ssml: string | undefined, generation: number) {
    /* Blocks with nothing to say, a lone image for one, are passed over. */
    while (ssml !== undefined) {
      const block = ssmlToText(ssml);
      if (block.text.trim() && block.marks.length) return this.#say(tts, block, generation);
      ssml = tts.next();
    }
    void this.#nextSection(generation);
  }

  #say(tts: FoliateTTS, { text, marks }: ReturnType<typeof ssmlToText>, generation: number) {
    /* Never speak without an on-device voice: left unset, the browser picks its own, which may send the text away. */
    if (typeof speechSynthesis === "undefined" || !this.voice?.localService) return this.#fail();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = this.rate;
    utterance.voice = this.voice;
    utterance.lang = this.voice.lang;
    /* The first word lights before its boundary arrives, so the highlight never lags the voice. */
    tts.setMark(marks[0].name);
    utterance.onboundary = (event) => {
      if (generation !== this.#generation || event.name !== "word") return;
      const mark = markAt(marks, event.charIndex);
      if (mark) tts.setMark(mark);
    };
    utterance.onend = () => {
      if (generation === this.#generation) this.#speak(tts, tts.next(), generation);
    };
    utterance.onerror = (event) => {
      if (generation !== this.#generation || event.error === "interrupted" || event.error === "canceled") return;
      this.#fail();
    };
    this.#utterance = utterance;
    speechSynthesis.speak(utterance);
  }

  async #nextSection(generation: number) {
    this.#utterance = null;
    let turned: boolean;
    try {
      turned = await this.#hooks.nextSection();
    } catch {
      if (generation === this.#generation) this.#fail();
      return;
    }
    if (generation !== this.#generation) return;
    if (!turned) {
      this.#silence();
      return this.#hooks.stopped("end");
    }
    const tts = await this.#tts();
    if (generation !== this.#generation) return;
    if (!tts) return this.#fail();
    this.#speak(tts, tts.start(), generation);
  }
}
