import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertAtCaret, resample } from "@/lib/shared/dictation";
import { MAX_PCM_BYTES, MODEL_BYTES, MODEL_NAME, installModel, isInstalled, modelsDir, parsePcm, resetRecognizer, speechStatus, startDownload, transcribe } from "@/lib/server/speech";

const floats = (...values: number[]) => new Float32Array(values).buffer;

describe("parsePcm", () => {
  it("reads little-endian float samples", () => {
    const parsed = parsePcm(floats(0.5, -1, 0));
    expect(parsed.ok && [...parsed.samples]).toEqual([0.5, -1, 0]);
  });

  it("zeroes samples that are not numbers", () => {
    const parsed = parsePcm(floats(NaN, Infinity, 0.25));
    expect(parsed.ok && [...parsed.samples]).toEqual([0, 0, 0.25]);
  });

  it("refuses empty and ragged bodies", () => {
    expect(parsePcm(new ArrayBuffer(0))).toMatchObject({ ok: false, status: 400 });
    expect(parsePcm(new ArrayBuffer(7))).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses more than 90 seconds with 413", () => {
    expect(parsePcm(new ArrayBuffer(MAX_PCM_BYTES))).toMatchObject({ ok: true });
    expect(parsePcm(new ArrayBuffer(MAX_PCM_BYTES + 4))).toMatchObject({ ok: false, status: 413 });
  });
});

describe("the model folder", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "rigg-learn-speech-"));
    vi.stubEnv("DATA_DIR", path.join(root, "data"));
    resetRecognizer();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(root, { recursive: true, force: true });
  });

  const installFake = async () => {
    const dir = path.join(root, "models", MODEL_NAME);
    await mkdir(dir, { recursive: true });
    for (const file of ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"]) await writeFile(path.join(dir, file), "x");
  };

  it("sits beside the data folder", () => {
    expect(modelsDir()).toBe(path.join(root, "models"));
  });

  it("is missing until every file is there", async () => {
    expect(await speechStatus()).toMatchObject({ state: "missing", total: MODEL_BYTES });
    const dir = path.join(root, "models", MODEL_NAME);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "tokens.txt"), "x");
    expect(await isInstalled()).toBe(false);
    await installFake();
    expect(await speechStatus()).toMatchObject({ state: "ready" });
  });

  it("refuses to transcribe without the model, and loads the recognizer once with it", async () => {
    const load = vi.fn(async () => ({ transcribe: () => "hello there" }));
    await expect(transcribe(new Float32Array(10), load)).rejects.toThrow("not installed");
    await installFake();
    expect(await transcribe(new Float32Array(10), load)).toBe("hello there");
    await transcribe(new Float32Array(10), load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("throws away a download of the wrong size and leaves nothing behind", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(100))));
    await expect(installModel("https://example.test/model.tar.bz2", 200)).rejects.toThrow("expected 200");
    expect(await isInstalled()).toBe(false);
    expect(await readdir(path.join(root, "models"))).toEqual([]);
  });

  it("throws away a download that does not hold the model", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(100))));
    await expect(installModel("https://example.test/model.tar.bz2", 100)).rejects.toThrow();
    expect(await isInstalled()).toBe(false);
    expect(await readdir(path.join(root, "models"))).toEqual([]);
  });

  it("clears the leftovers of a crashed download", async () => {
    await mkdir(path.join(root, "models", ".tmp-crashed"), { recursive: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 404 })));
    await expect(installModel()).rejects.toThrow("HTTP 404");
    expect(await readdir(path.join(root, "models"))).toEqual([]);
  });

  it("runs one download for any number of askers, then reports why it failed", async () => {
    const fetchMock = vi.fn(async () => new Response("no", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const first = startDownload();
    const second = startDownload();
    expect((await Promise.all([first, second])).map((status) => status.state)).toEqual(["downloading", "downloading"]);
    await vi.waitFor(async () => expect((await speechStatus()).state).toBe("missing"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await speechStatus()).error).toContain("HTTP 500");
  });

  it("does not download what is already installed", async () => {
    await installFake();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await startDownload()).state).toBe("ready");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("insertAtCaret", () => {
  it("adds words at the caret with spaces only where needed", () => {
    expect(insertAtCaret("", 0, 0, "hello", 100)).toEqual({ value: "hello", caret: 5 });
    expect(insertAtCaret("ab cd", 2, 2, "xy", 100)).toEqual({ value: "ab xy cd", caret: 5 });
    expect(insertAtCaret("ab ", 3, 3, "xy", 100)).toEqual({ value: "ab xy", caret: 5 });
  });

  it("replaces a selection and respects the limit", () => {
    expect(insertAtCaret("one two three", 4, 7, "2", 100).value).toBe("one 2 three");
    expect(insertAtCaret("abc", 3, 3, "defghij", 6).value).toHaveLength(6);
  });
});

describe("resample", () => {
  it("keeps the rate when it matches and scales the length otherwise", () => {
    const samples = new Float32Array([0, 1, 0, -1]);
    expect(resample(samples, 16000, 16000)).toBe(samples);
    expect(resample(new Float32Array(480), 48000, 16000)).toHaveLength(160);
  });
});
