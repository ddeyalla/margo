import { forkModel, localModel, type Loaded } from "./localModel";

/* The reading voice runs on this machine: Kokoro 82M, through sherpa-onnx, in its own process
   (lib/server/voice-process.cjs). The book's text is never sent anywhere to be spoken. */

export const VOICE_MODEL_NAME = "kokoro-multi-lang-v1_0";
export const VOICE_MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${VOICE_MODEL_NAME}.tar.bz2`;
/** The archive's exact size. A download of any other length is thrown away. */
export const VOICE_MODEL_BYTES = 349_886_476;
/** Longer text is refused: foliate hands out one paragraph at a time. */
export const MAX_TEXT = 4000;

/** Unloaded after this long without a request. Reading asks every few seconds, so a pause has to be long. */
export const VOICE_IDLE_MS = 10 * 60_000;

export interface Speech {
  samples: Float32Array;
  sampleRate: number;
}

export type Lexicon = "us" | "gb";

export interface Voice extends Loaded {
  say(text: string, speaker: number, lexicon: Lexicon, speed: number): Promise<Speech>;
}

const kokoro = localModel<Voice>(
  { name: VOICE_MODEL_NAME, url: VOICE_MODEL_URL, bytes: VOICE_MODEL_BYTES, files: ["model.onnx", "voices.bin", "tokens.txt", "lexicon-us-en.txt", "lexicon-gb-en.txt"], label: "voice model" },
  VOICE_IDLE_MS,
);

export const voiceStatus = kokoro.status;
export const startVoiceDownload = kokoro.startDownload;
export const isVoiceInstalled = kokoro.isInstalled;
export const resetVoice = kokoro.reset;

const startVoice = async (): Promise<Voice> => {
  const model = await forkModel<{ text: string; speaker: number; lexicon: Lexicon; speed: number }, Speech>("voice-process.cjs", { MARGO_VOICE_MODEL: kokoro.dir() }, "voice model");
  return {
    get running() {
      return model.running;
    },
    say: async (text, speaker, lexicon, speed) => {
      const { samples, sampleRate } = await model.ask({ text, speaker, lexicon, speed });
      return { samples, sampleRate };
    },
    close: model.close,
  };
};

/** The text spoken by one of the model's speakers. The model loads on the first call. Throws if it is not installed. */
export const say = (text: string, speaker: number, lexicon: Lexicon, speed: number, load: () => Promise<Voice> = startVoice) =>
  kokoro.use(load, (voice) => voice.say(text, speaker, lexicon, speed));
