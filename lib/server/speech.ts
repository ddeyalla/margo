import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getFolders } from "./config";

/* Voice input runs on this machine. Parakeet TDT 0.6B v3 (int8) is decoded by sherpa-onnx; the
   model is downloaded once, on request, into a models folder beside the data folder. */

export const MODEL_NAME = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8";
export const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_NAME}.tar.bz2`;
/** The archive's exact size. A download of any other length is thrown away. */
export const MODEL_BYTES = 487_211_443;
const MODEL_FILES = ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"];

export const SAMPLE_RATE = 16_000;
export const MAX_SECONDS = 90;
export const MAX_PCM_BYTES = MAX_SECONDS * SAMPLE_RATE * 4;

export interface SpeechStatus {
  state: "missing" | "downloading" | "ready";
  /** Bytes downloaded so far and in all, while downloading. */
  done: number;
  total: number;
  /** Why the last download failed, until the next one starts. */
  error: string | null;
}

/** Beside the data folder, so the app and a source checkout each keep their own. */
export const modelsDir = () => path.join(path.dirname(getFolders().dataDir), "models");
const modelDir = () => path.join(modelsDir(), MODEL_NAME);

/* One download and one recognizer for the whole process, even across dev reloads. */
const state = ((globalThis as { __riggSpeech?: { download: Promise<void> | null; done: number; error: string | null; recognizer: Promise<Recognizer> | null } }).__riggSpeech ??= {
  download: null,
  done: 0,
  error: null,
  recognizer: null,
});

/** The model counts as installed only when every file is there; the folder appears by rename, never half full. */
export const isInstalled = async (dir = modelDir()) => {
  try {
    await Promise.all(MODEL_FILES.map((file) => access(path.join(dir, file))));
    return true;
  } catch {
    return false;
  }
};

export const speechStatus = async (): Promise<SpeechStatus> => {
  if (await isInstalled()) return { state: "ready", done: MODEL_BYTES, total: MODEL_BYTES, error: null };
  if (state.download) return { state: "downloading", done: state.done, total: MODEL_BYTES, error: null };
  return { state: "missing", done: 0, total: MODEL_BYTES, error: state.error };
};

const extract = (archive: string, into: string) =>
  new Promise<void>((resolve, reject) => {
    const tar = spawn("tar", ["xjf", archive, "-C", into], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    tar.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString().slice(0, 500)));
    tar.on("error", reject);
    tar.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`tar failed: ${stderr.trim() || `exit ${code}`}`))));
  });

/**
 * Downloads the archive to a temp file, checks its size, unpacks it in a temp folder and renames
 * that into place. A crash leaves temp files, which the next download clears, never a half model.
 */
export const installModel = async (url = MODEL_URL, bytes = MODEL_BYTES) => {
  const root = modelsDir();
  await mkdir(root, { recursive: true });
  for (const entry of await readdir(root)) if (entry.startsWith(".tmp-")) await rm(path.join(root, entry), { recursive: true, force: true });
  const work = await mkdtemp(path.join(root, ".tmp-"));
  try {
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`The download failed (HTTP ${response.status}).`);
    const archive = path.join(work, "model.tar.bz2");
    const counted = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
    counted.on("data", (chunk: Buffer) => (state.done += chunk.length));
    await pipeline(counted, createWriteStream(archive));
    const size = (await stat(archive)).size;
    if (size !== bytes) throw new Error(`The download was ${size} bytes, expected ${bytes}.`);
    const unpacked = path.join(work, "unpacked");
    await mkdir(unpacked);
    await extract(archive, unpacked);
    const found = path.join(unpacked, MODEL_NAME);
    if (!(await isInstalled(found))) throw new Error("The download did not contain the model.");
    await rm(modelDir(), { recursive: true, force: true });
    await rename(found, modelDir());
  } finally {
    await rm(work, { recursive: true, force: true });
  }
};

/** Starts the download unless one is already running, here or from another window. */
export const startDownload = async (): Promise<SpeechStatus> => {
  /* Set before any await, so two askers at once still share one download. */
  state.download ??= (async () => {
    if (await isInstalled()) return;
    state.done = 0;
    state.error = null;
    await installModel();
  })()
    .catch((error: unknown) => {
      state.error = error instanceof Error ? error.message : "The download failed.";
    })
    .finally(() => {
      state.download = null;
    });
  return speechStatus();
};

/** Raw little-endian 32-bit float samples to a Float32Array this process owns, or why not. */
export const parsePcm = (body: ArrayBuffer): { ok: true; samples: Float32Array } | { ok: false; status: 400 | 413; error: string } => {
  if (body.byteLength > MAX_PCM_BYTES) return { ok: false, status: 413, error: `Recordings are limited to ${MAX_SECONDS} seconds.` };
  if (body.byteLength === 0 || body.byteLength % 4 !== 0) return { ok: false, status: 400, error: "Expected 16 kHz mono 32-bit float samples." };
  const view = new DataView(body);
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

export interface Recognizer {
  transcribe(samples: Float32Array): string;
}

const loadRecognizer = async (): Promise<Recognizer> => {
  const sherpa = await import("sherpa-onnx-node");
  const dir = modelDir();
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: path.join(dir, MODEL_FILES[0]), decoder: path.join(dir, MODEL_FILES[1]), joiner: path.join(dir, MODEL_FILES[2]) },
      tokens: path.join(dir, MODEL_FILES[3]),
      numThreads: 4,
      provider: "cpu",
      modelType: "nemo_transducer",
    },
  });
  return {
    /* Decoding blocks this process for about a thirtieth of the audio's length. Only JS-owned arrays go in:
       the library's own wave reader hands back native memory, which Electron's Node refuses. */
    transcribe(samples) {
      const stream = recognizer.createStream();
      stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
      recognizer.decode(stream);
      return dropFillers(recognizer.getResult(stream).text);
    },
  };
};

/** The words in the recording. The model loads on the first call and stays loaded. Throws if it is not installed. */
export const transcribe = async (samples: Float32Array, load: () => Promise<Recognizer> = loadRecognizer) => {
  if (!(await isInstalled())) throw new Error("The speech model is not installed.");
  state.recognizer ??= load().catch((error: unknown) => {
    state.recognizer = null;
    throw error;
  });
  return (await state.recognizer).transcribe(samples);
};

/** Forgets the loaded recognizer. For tests. */
export const resetRecognizer = () => {
  state.recognizer = null;
};
