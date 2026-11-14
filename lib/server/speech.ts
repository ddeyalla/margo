import { fork, spawn } from "node:child_process";
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
/** A download that receives nothing for this long is given up, so a retry can start. */
const STALL_MS = 60_000;
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
export const modelsDir = () => path.join(/*turbopackIgnore: true*/ path.dirname(/*turbopackIgnore: true*/ getFolders().dataDir), "models");
const modelDir = () => path.join(/*turbopackIgnore: true*/ modelsDir(), MODEL_NAME);

/* One download and one recognizer for the whole process, even across dev reloads. */
interface SpeechState {
  download: Promise<void> | null;
  done: number;
  error: string | null;
  recognizer: Promise<Recognizer> | null;
  /** Requests being decoded right now; the model is never unloaded under one. */
  busy: number;
  idle: ReturnType<typeof setTimeout> | null;
}
const state: SpeechState = ((globalThis as { __riggSpeech?: SpeechState }).__riggSpeech ??= { download: null, done: 0, error: null, recognizer: null, busy: 0, idle: null });
/* A dev reload keeps the old state object, which may predate these fields. */
state.busy ??= 0;
state.idle ??= null;

/** The model counts as installed only when every file is there; the folder appears by rename, never half full. */
export const isInstalled = async (dir = modelDir()) => {
  try {
    await Promise.all(MODEL_FILES.map((file) => access(path.join(/*turbopackIgnore: true*/ dir, file))));
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
export const installModel = async (url = MODEL_URL, bytes = MODEL_BYTES, stallMs = STALL_MS) => {
  const root = modelsDir();
  await mkdir(root, { recursive: true });
  for (const entry of await readdir(root)) if (entry.startsWith(".tmp-")) await rm(path.join(/*turbopackIgnore: true*/ root, entry), { recursive: true, force: true });
  const work = await mkdtemp(path.join(/*turbopackIgnore: true*/ root, ".tmp-"));
  /* The timer restarts whenever bytes arrive; if it runs out the transfer is aborted. */
  const controller = new AbortController();
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, stallMs);
  };
  try {
    watch();
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`The download failed (HTTP ${response.status}).`);
    const archive = path.join(/*turbopackIgnore: true*/ work, "model.tar.bz2");
    const counted = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
    counted.on("data", (chunk: Buffer) => {
      state.done += chunk.length;
      watch();
    });
    await pipeline(counted, createWriteStream(archive));
    const size = (await stat(archive)).size;
    if (size !== bytes) throw new Error(`The download was ${size} bytes, expected ${bytes}.`);
    const unpacked = path.join(/*turbopackIgnore: true*/ work, "unpacked");
    await mkdir(unpacked);
    await extract(archive, unpacked);
    const found = path.join(/*turbopackIgnore: true*/ unpacked, MODEL_NAME);
    if (!(await isInstalled(found))) throw new Error("The download did not contain the model.");
    await rm(modelDir(), { recursive: true, force: true });
    await rename(found, modelDir());
  } catch (error) {
    if (stalled) throw new Error(`The download stalled: nothing arrived for ${Math.round(stallMs / 1000)} seconds. Try again.`);
    throw error;
  } finally {
    clearTimeout(timer);
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
  transcribe(samples: Float32Array): Promise<string>;
  /** False once the process behind it has exited, so the next request starts a fresh one. */
  readonly running: boolean;
  close(): void;
}

/** The model is unloaded after this long without a request, giving back its memory (about 1.4 GB). */
export const IDLE_MS = 5 * 60_000;

/** Starts the model in its own process (lib/server/speech-process.cjs), so decoding never blocks this server. */
const startRecognizer = () =>
  new Promise<Recognizer>((resolve, reject) => {
    const script = path.join(/*turbopackIgnore: true*/ process.cwd(), "lib", "server", "speech-process.cjs");
    /* Under the Mac app, this is Electron's own Node, which the inherited ELECTRON_RUN_AS_NODE keeps a plain Node. */
    const child = fork(script, [], {
      serialization: "advanced",
      execArgv: [],
      env: { ...process.env, RIGG_SPEECH_MODEL: modelDir() },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    const waiting = new Map<number, { resolve(text: string): void; reject(error: Error): void }>();
    let next = 0;
    let running = true;
    const recognizer: Recognizer = {
      get running() {
        return running;
      },
      transcribe: (samples) =>
        new Promise((resolve, reject) => {
          const id = next++;
          waiting.set(id, { resolve, reject });
          child.send({ id, samples }, (error) => {
            if (!error) return;
            waiting.delete(id);
            reject(new Error("The speech model stopped. Try again."));
          });
        }),
      close: () => {
        running = false;
        child.kill();
      },
    };
    child.on("message", (message: { type?: string; id?: number; text?: string; error?: string }) => {
      if (message.type === "ready") return resolve(recognizer);
      if (message.type === "failed") return reject(new Error(`Could not load the speech model: ${message.error}`));
      const asker = waiting.get(message.id ?? -1);
      if (!asker) return;
      waiting.delete(message.id!);
      if (message.error) asker.reject(new Error(message.error));
      else asker.resolve(message.text ?? "");
    });
    const stopped = (error: Error) => {
      running = false;
      reject(error);
      for (const asker of waiting.values()) asker.reject(error);
      waiting.clear();
    };
    child.on("error", (error) => stopped(new Error(`Could not start the speech model: ${error.message}`)));
    child.on("exit", () => stopped(new Error("The speech model stopped. Try again.")));
  });

/** Unloads the model once nothing has asked for a while. */
const scheduleUnload = () => {
  clearTimeout(state.idle ?? undefined);
  state.idle = setTimeout(() => {
    const loaded = state.recognizer;
    if (state.busy > 0 || !loaded) return;
    state.recognizer = null;
    void loaded.then((recognizer) => recognizer.close(), () => {});
  }, IDLE_MS);
  state.idle.unref?.();
};

/** The words in the recording. The model loads on the first call and unloads after IDLE_MS unused. Throws if it is not installed. */
export const transcribe = async (samples: Float32Array, load: () => Promise<Recognizer> = startRecognizer) => {
  state.busy++;
  clearTimeout(state.idle ?? undefined);
  try {
    if (!(await isInstalled())) throw new Error("The speech model is not installed.");
    let loading = state.recognizer;
    if (loading && !(await loading.catch(() => null))?.running) loading = null;
    if (!loading) {
      loading = state.recognizer = load();
      loading.catch(() => {
        if (state.recognizer === loading) state.recognizer = null;
      });
    }
    return dropFillers(await (await loading).transcribe(samples));
  } finally {
    state.busy--;
    scheduleUnload();
  }
};

/** Unloads the model now. For tests. */
export const resetRecognizer = () => {
  clearTimeout(state.idle ?? undefined);
  void state.recognizer?.then((recognizer) => recognizer.close(), () => {});
  state.recognizer = null;
  state.busy = 0;
};
