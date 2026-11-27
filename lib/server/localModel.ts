import { fork, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getFolders } from "./config";

/* A model that runs on this machine: downloaded once, on request, into a models folder beside the
   data folder, then loaded in its own process on first use and unloaded after it sits unused. Voice
   input (Parakeet) and the reading voice (Kokoro) are both one of these. */

export interface ModelSpec {
  /** The archive's top folder, also the folder it is kept in. */
  name: string;
  url: string;
  /** The archive's exact size. A download of any other length is thrown away. */
  bytes: number;
  /** Files (or folders) that must all be there for the model to count as installed. */
  files: string[];
  /** For messages: "speech model", "voice model". */
  label: string;
}

export interface ModelStatus {
  state: "missing" | "downloading" | "ready";
  /** Bytes downloaded so far and in all, while downloading. */
  done: number;
  total: number;
  /** Why the last download failed, until the next one starts. */
  error: string | null;
}

/** A loaded model, behind a process. */
export interface Loaded {
  /** False once the process behind it has exited, so the next request starts a fresh one. */
  readonly running: boolean;
  close(): void;
}

/** A download that receives nothing for this long is given up, so a retry can start. */
const STALL_MS = 60_000;

/** Beside the data folder, so the app and a source checkout each keep their own. */
export const modelsDir = () => path.join(/*turbopackIgnore: true*/ path.dirname(/*turbopackIgnore: true*/ getFolders().dataDir), "models");

interface ModelState {
  download: Promise<void> | null;
  done: number;
  error: string | null;
  loaded: Promise<Loaded> | null;
  /** Requests running right now; the model is never unloaded under one. */
  busy: number;
  idle: ReturnType<typeof setTimeout> | null;
}

/* One download and one loaded model per spec for the whole process, even across dev reloads. */
const states = ((globalThis as { __margoModels?: Map<string, ModelState> }).__margoModels ??= new Map());
const stateOf = (name: string): ModelState => {
  let state = states.get(name);
  if (!state) states.set(name, (state = { download: null, done: 0, error: null, loaded: null, busy: 0, idle: null }));
  return state;
};

const extract = (archive: string, into: string) =>
  new Promise<void>((resolve, reject) => {
    const tar = spawn("tar", ["xjf", archive, "-C", into], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    tar.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString().slice(0, 500)));
    tar.on("error", reject);
    tar.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`tar failed: ${stderr.trim() || `exit ${code}`}`))));
  });

export const localModel = <T extends Loaded>(spec: ModelSpec, idleMs: number) => {
  const state = stateOf(spec.name);
  const dir = () => path.join(/*turbopackIgnore: true*/ modelsDir(), spec.name);

  /** Installed only when every file is there; the folder appears by rename, never half full. */
  const isInstalled = async (at = dir()) => {
    try {
      await Promise.all(spec.files.map((file) => access(path.join(/*turbopackIgnore: true*/ at, file))));
      return true;
    } catch {
      return false;
    }
  };

  const status = async (): Promise<ModelStatus> => {
    if (await isInstalled()) return { state: "ready", done: spec.bytes, total: spec.bytes, error: null };
    if (state.download) return { state: "downloading", done: state.done, total: spec.bytes, error: null };
    return { state: "missing", done: 0, total: spec.bytes, error: state.error };
  };

  /**
   * Downloads the archive to a temp file, checks its size, unpacks it in a temp folder and renames
   * that into place. A crash leaves temp files, which the next download clears, never a half model.
   */
  const install = async (url = spec.url, bytes = spec.bytes, stallMs = STALL_MS) => {
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
      const found = path.join(/*turbopackIgnore: true*/ unpacked, spec.name);
      if (!(await isInstalled(found))) throw new Error("The download did not contain the model.");
      await rm(dir(), { recursive: true, force: true });
      await rename(found, dir());
    } catch (error) {
      if (stalled) throw new Error(`The download stalled: nothing arrived for ${Math.round(stallMs / 1000)} seconds. Try again.`);
      throw error;
    } finally {
      clearTimeout(timer);
      await rm(work, { recursive: true, force: true });
    }
  };

  /** Starts the download unless one is already running, here or from another window. */
  const startDownload = async (): Promise<ModelStatus> => {
    /* Set before any await, so two askers at once still share one download. */
    state.download ??= (async () => {
      if (await isInstalled()) return;
      state.done = 0;
      state.error = null;
      await install();
    })()
      .catch((error: unknown) => {
        state.error = error instanceof Error ? error.message : "The download failed.";
      })
      .finally(() => {
        state.download = null;
      });
    return status();
  };

  /** Unloads the model once nothing has asked for a while. */
  const scheduleUnload = () => {
    clearTimeout(state.idle ?? undefined);
    state.idle = setTimeout(() => {
      const loaded = state.loaded;
      if (state.busy > 0 || !loaded) return;
      state.loaded = null;
      void loaded.then((model) => model.close(), () => {});
    }, idleMs);
    state.idle.unref?.();
  };

  /** Runs `work` on the model, loading it first if needed. Throws if it is not installed. */
  const use = async <R>(load: () => Promise<T>, work: (model: T) => Promise<R>): Promise<R> => {
    state.busy++;
    clearTimeout(state.idle ?? undefined);
    try {
      if (!(await isInstalled())) throw new Error(`The ${spec.label} is not installed.`);
      let loading = state.loaded as Promise<T> | null;
      if (loading && !(await loading.catch(() => null))?.running) loading = null;
      if (!loading) {
        const started = load();
        loading = started;
        state.loaded = started;
        started.catch(() => {
          if (state.loaded === started) state.loaded = null;
        });
      }
      return await work(await loading);
    } finally {
      state.busy--;
      scheduleUnload();
    }
  };

  /** Unloads the model now. For tests. */
  const reset = () => {
    clearTimeout(state.idle ?? undefined);
    void state.loaded?.then((model) => model.close(), () => {});
    state.loaded = null;
    state.busy = 0;
  };

  return { dir, isInstalled, status, install, startDownload, use, reset };
};

/**
 * Starts a model's script in its own process, so the model never blocks this server. The script answers
 * { type: "ready" } or { type: "failed", error }, then { id, ...result } or { id, error } for each request.
 * Under the Mac app, this is Electron's own Node, which the inherited ELECTRON_RUN_AS_NODE keeps a plain Node.
 */
export const forkModel = <Req extends object, Res>(script: string, env: Record<string, string>, label: string) =>
  new Promise<Loaded & { ask(request: Req): Promise<Res> }>((resolve, reject) => {
    const child = fork(path.join(/*turbopackIgnore: true*/ process.cwd(), "lib", "server", script), [], {
      serialization: "advanced",
      execArgv: [],
      env: { ...process.env, ...env },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    const waiting = new Map<number, { resolve(result: Res): void; reject(error: Error): void }>();
    let next = 0;
    let running = true;
    const model = {
      get running() {
        return running;
      },
      ask: (request: Req) =>
        new Promise<Res>((resolve, reject) => {
          const id = next++;
          waiting.set(id, { resolve, reject });
          child.send({ id, ...request }, (error) => {
            if (!error) return;
            waiting.delete(id);
            reject(new Error(`The ${label} stopped. Try again.`));
          });
        }),
      close: () => {
        running = false;
        child.kill();
      },
    };
    child.on("message", (message: { type?: string; id?: number; error?: string }) => {
      if (message.type === "ready") return resolve(model);
      if (message.type === "failed") return reject(new Error(`Could not load the ${label}: ${message.error}`));
      const asker = waiting.get(message.id ?? -1);
      if (!asker) return;
      waiting.delete(message.id!);
      if (message.error) asker.reject(new Error(message.error));
      else asker.resolve(message as Res);
    });
    const stopped = (error: Error) => {
      running = false;
      reject(error);
      for (const asker of waiting.values()) asker.reject(error);
      waiting.clear();
    };
    child.on("error", (error) => stopped(new Error(`Could not start the ${label}: ${error.message}`)));
    child.on("exit", () => stopped(new Error(`The ${label} stopped. Try again.`)));
  });
