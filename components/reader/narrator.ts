import { markAt, ssmlToText } from "./ssml";
import { DEFAULT_VOICE, type VoiceId } from "@/lib/shared/voices";

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

/** Where a block is cut for the voice: after a sentence's end and any closing quote or bracket. */
const SENTENCE_END = /[.!?…]+["'”’)\]]*\s+/g;

/** A block's text cut into sentences, each with where it starts and ends in the block. Short ones join the next. */
export const sentencesOf = (text: string): { start: number; end: number }[] => {
  const parts: { start: number; end: number }[] = [];
  let start = 0;
  for (const match of text.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length;
    if (end - start < 24) continue;
    parts.push({ start, end });
    start = end;
  }
  if (start < text.length) parts.push({ start, end: text.length });
  return parts.filter((part) => text.slice(part.start, part.end).trim());
};

/** Speaks text on this machine (POST /api/voice/say) and decodes it for Web Audio. */
export const fetchSpeech = async (context: BaseAudioContext, text: string, voice: VoiceId, speed: number): Promise<AudioBuffer> => {
  const response = await fetch("/api/voice/say", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice, speed }),
  });
  if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? "Speaking failed.");
  const samples = new Float32Array(await response.arrayBuffer());
  const buffer = context.createBuffer(1, Math.max(1, samples.length), Number(response.headers.get("X-Sample-Rate")) || 24_000);
  buffer.copyToChannel(samples, 0);
  return buffer;
};

export interface NarratorHooks {
  /** The TTS for the section on screen, made if needed. */
  tts(): Promise<FoliateTTS | null>;
  /** Turns to the next section; false when the book has none. */
  nextSection(): Promise<boolean>;
  /** Reading stopped on its own: the book ended, or the voice failed. */
  stopped(reason: "end" | "error"): void;
}

type Say = (context: BaseAudioContext, text: string, voice: VoiceId, speed: number) => Promise<AudioBuffer>;

/**
 * Speaks a book a block at a time in the Kokoro voice on this machine, a sentence at a time so the next
 * sentence is made while this one plays, and moves foliate's mark along with the voice. Kokoro gives no
 * word timings, so the mark moves through each sentence at the rate its characters are spoken: close, not
 * exact. Every play carries a generation, so audio an older play asked for is dropped when it arrives.
 */
export class Narrator {
  rate = 1;
  voice: VoiceId = DEFAULT_VOICE;
  #hooks: NarratorHooks;
  #say: Say;
  #generation = 0;
  #context: AudioContext | null = null;
  #source: AudioBufferSourceNode | null = null;
  #ticker: ReturnType<typeof setInterval> | null = null;

  constructor(hooks: NarratorHooks, say: Say = fetchSpeech) {
    this.#hooks = hooks;
    this.#say = say;
  }

  /** Starts at `from`, or at the last word read when null. */
  async play(from: Range | null) {
    const generation = this.#silence();
    this.#context ??= new AudioContext();
    void this.#context.resume();
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
    void this.#speak(tts, ssml, generation);
  }

  /** Stops the voice; the last word stays marked, and `play(null)` goes on from it. */
  pause() {
    this.#silence();
  }

  #silence() {
    this.#generation += 1;
    clearInterval(this.#ticker ?? undefined);
    this.#ticker = null;
    const source = this.#source;
    this.#source = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        /* Never started. */
      }
    }
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

  async #speak(tts: FoliateTTS, ssml: string | undefined, generation: number) {
    /* Blocks with nothing to say, a lone image for one, are passed over. */
    while (ssml !== undefined) {
      const block = ssmlToText(ssml);
      if (block.text.trim() && block.marks.length) {
        const done = await this.#sayBlock(tts, block, generation);
        if (!done) return;
      }
      if (generation !== this.#generation) return;
      ssml = tts.next();
    }
    void this.#nextSection(generation);
  }

  /** Speaks one block. True when it was spoken to the end, false when it was stopped or failed. */
  async #sayBlock(tts: FoliateTTS, { text, marks }: ReturnType<typeof ssmlToText>, generation: number) {
    const context = this.#context!;
    const sentences = sentencesOf(text);
    const make = (i: number) => this.#say(context, text.slice(sentences[i].start, sentences[i].end).trim(), this.voice, this.rate);
    /* The first word lights before the audio arrives, so the page shows where reading starts. */
    tts.setMark(marks[0].name);
    let next = make(0);
    for (let i = 0; i < sentences.length; i++) {
      let buffer: AudioBuffer;
      try {
        buffer = await next;
      } catch {
        if (generation === this.#generation) this.#fail();
        return false;
      }
      if (generation !== this.#generation) return false;
      if (i + 1 < sentences.length) next = make(i + 1);
      /* A rejected prefetch is reported when its turn comes, not as an unhandled rejection now. */
      next.catch(() => {});
      await this.#playBuffer(tts, buffer, sentences[i], marks, generation);
      if (generation !== this.#generation) return false;
    }
    return true;
  }

  #playBuffer(tts: FoliateTTS, buffer: AudioBuffer, sentence: { start: number; end: number }, marks: ReturnType<typeof ssmlToText>["marks"], generation: number) {
    const context = this.#context!;
    return new Promise<void>((resolve) => {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const began = context.currentTime;
      let lit: string | null = null;
      clearInterval(this.#ticker ?? undefined);
      this.#ticker = setInterval(() => {
        if (generation !== this.#generation) return;
        const progress = Math.min(1, (context.currentTime - began) / buffer.duration);
        const mark = markAt(marks, Math.floor(sentence.start + progress * (sentence.end - sentence.start)));
        if (mark && mark !== lit) tts.setMark((lit = mark));
      }, 50);
      source.onended = () => {
        clearInterval(this.#ticker ?? undefined);
        this.#ticker = null;
        resolve();
      };
      this.#source = source;
      source.start();
    });
  }

  async #nextSection(generation: number) {
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
    void this.#speak(tts, tts.start(), generation);
  }
}
