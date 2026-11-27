import { forkModel, localModel, modelsDir, type ModelStatus } from "./localModel";

/* Voice input runs on this machine. Parakeet TDT 0.6B v3 (int8) is decoded by sherpa-onnx in its own
   process (lib/server/speech-process.cjs); the model is downloaded once, on request. */

export const MODEL_NAME = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8";
export const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_NAME}.tar.bz2`;
/** The archive's exact size. A download of any other length is thrown away. */
export const MODEL_BYTES = 487_211_443;

export const SAMPLE_RATE = 16_000;
export const MAX_SECONDS = 90;
export const MAX_PCM_BYTES = MAX_SECONDS * SAMPLE_RATE * 4;

export type SpeechStatus = ModelStatus;
export { modelsDir };

/** The model is unloaded after this long without a request, giving back its memory (about 1.4 GB). */
export const IDLE_MS = 5 * 60_000;

export interface Recognizer {
  transcribe(samples: Float32Array): Promise<string>;
  /** False once the process behind it has exited, so the next request starts a fresh one. */
  readonly running: boolean;
  close(): void;
}

const parakeet = localModel<Recognizer>(
  { name: MODEL_NAME, url: MODEL_URL, bytes: MODEL_BYTES, files: ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"], label: "speech model" },
  IDLE_MS,
);

export const isInstalled = parakeet.isInstalled;
export const speechStatus = parakeet.status;
export const installModel = parakeet.install;
export const startDownload = parakeet.startDownload;
/** Unloads the model now. For tests. */
export const resetRecognizer = parakeet.reset;

/** Raw little-endian 32-bit float samples to a Float32Array this process owns, or why not. */
export const parsePcm = (body: ArrayBuffer | Uint8Array): { ok: true; samples: Float32Array } | { ok: false; status: 400 | 413; error: string } => {
  if (body.byteLength > MAX_PCM_BYTES) return { ok: false, status: 413, error: `Recordings are limited to ${MAX_SECONDS} seconds.` };
  if (body.byteLength === 0 || body.byteLength % 4 !== 0) return { ok: false, status: 400, error: "Expected 16 kHz mono 32-bit float samples." };
  /* A Buffer may be a slice of a shared pool, so the view starts at its own offset. */
  const view = body instanceof Uint8Array ? new DataView(body.buffer, body.byteOffset, body.byteLength) : new DataView(body);
  const samples = new Float32Array(body.byteLength / 4);
  for (let i = 0; i < samples.length; i++) {
    const value = view.getFloat32(i * 4, true);
    samples[i] = Number.isFinite(value) ? value : 0;
  }
  return { ok: true, samples };
};

/** Takes out the "uh"s and "um"s people say while thinking, with a comma that only followed them. */
export const dropFillers = (text: string) =>
  text
    .replace(/(^|[\s,.?!])(?:uh+|um+|uhm+|erm+|hmm+)(?=$|[\s,.?!])[,.]?/gi, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.?!])/g, "$1")
    .trim();

const startRecognizer = async (): Promise<Recognizer> => {
  const model = await forkModel<{ samples: Float32Array }, { text?: string }>("speech-process.cjs", { MARGO_SPEECH_MODEL: parakeet.dir() }, "speech model");
  return {
    get running() {
      return model.running;
    },
    transcribe: async (samples) => (await model.ask({ samples })).text ?? "",
    close: model.close,
  };
};

/** The words in the recording. The model loads on the first call and unloads after IDLE_MS unused. Throws if it is not installed. */
export const transcribe = async (samples: Float32Array, load: () => Promise<Recognizer> = startRecognizer) =>
  dropFillers(await parakeet.use(load, (recognizer) => recognizer.transcribe(samples)));
