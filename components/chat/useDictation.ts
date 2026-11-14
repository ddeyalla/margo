"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { resample } from "@/lib/shared/dictation";

const SAMPLE_RATE = 16_000;
/** The server refuses more; stop a little short of it. */
const MAX_SECONDS = 88;
const MIN_SECONDS = 0.4;

export type DictationPhase = "idle" | "starting" | "recording" | "transcribing" | "consent" | "downloading";

interface ModelStatus {
  state: "missing" | "downloading" | "ready";
  done: number;
  total: number;
  error: string | null;
}

let active = 0;
/** True while any field is recording or transcribing, so a window refresh does not throw the words away. */
export const dictationBusy = () => active > 0;

/** The one field that is dictating. Starting in another field cancels it, so only one microphone is open and Escape means one thing. */
let current: (() => void) | null = null;
const claim = (cancel: () => void) => {
  if (current && current !== cancel) current();
  current = cancel;
};

const readStatus = async (): Promise<ModelStatus> => {
  const response = await fetch("/api/speech", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not check the speech model.");
  return response.json();
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const micError = (error: unknown) => {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "The microphone is blocked. Allow it for this app in your system settings.";
  if (name === "NotFoundError") return "No microphone was found.";
  return error instanceof Error ? error.message : "Could not use the microphone.";
};

/**
 * Speak instead of type. toggle() starts a recording, and stops it to transcribe; `onText` gets the words.
 * Audio never leaves this machine: 16 kHz samples go to this app's own server, which decodes them with a local model.
 * The first use asks before downloading the model. Escape cancels. A transcript that arrives after the
 * field is gone is dropped, because onText is not called once the component has unmounted.
 */
export function useDictation(onText: (words: string) => void) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  /* A line under the field: a problem, or for good news `error: false`. */
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const setNotice = (text: string | null, error = true) => setNote(text ? { text, error } : null);
  const alive = useRef(true);
  /* Bumped by every start and cancel; work that finds it changed has been cancelled. */
  const run = useRef(0);
  const capture = useRef<{
    stream: MediaStream;
    context: AudioContext;
    node: AudioWorkletNode;
    analyser: AnalyserNode;
    chunks: Float32Array[];
    length: number;
  } | null>(null);
  const request = useRef<AbortController | null>(null);
  const latest = useRef(onText);
  useEffect(() => {
    latest.current = onText;
  });

  const release = useCallback(() => {
    const open = capture.current;
    capture.current = null;
    if (!open) return;
    open.node.port.onmessage = null;
    open.node.disconnect();
    open.stream.getTracks().forEach((track) => track.stop());
    void open.context.close().catch(() => {});
  }, []);

  const cancel: () => void = useCallback(() => {
    run.current++;
    request.current?.abort();
    request.current = null;
    release();
    if (current === cancel) current = null;
    setNote(null);
    setPhase("idle");
  }, [release]);

  useEffect(() => {
    alive.current = true;
    const token = run;
    return () => {
      alive.current = false;
      token.current++;
      request.current?.abort();
      release();
      if (current === cancel) current = null;
    };
  }, [release, cancel]);

  const busy = phase === "starting" || phase === "recording" || phase === "transcribing";
  useEffect(() => {
    if (!busy) return;
    active++;
    return () => {
      active--;
    };
  }, [busy]);

  const transcribe = async (samples: Float32Array, mine: number) => {
    setPhase("transcribing");
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch("/api/speech/transcribe", {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: samples as Float32Array<ArrayBuffer>,
        signal: controller.signal,
      });
      const body: { text?: string; error?: string } = await response.json().catch(() => ({}));
      if (run.current !== mine || !alive.current) return;
      if (response.status === 409) {
        setPhase("consent");
        return;
      }
      if (!response.ok) throw new Error(body.error ?? "Transcription failed.");
      setPhase("idle");
      if (body.text) latest.current(body.text);
      else setNotice("Nothing was heard.", false);
    } catch (error) {
      if (run.current !== mine || !alive.current) return;
      setNotice(error instanceof Error ? error.message : "Transcription failed.");
      setPhase("idle");
    } finally {
      if (request.current === controller) request.current = null;
    }
  };

  const stop = async () => {
    const open = capture.current;
    if (!open) return;
    const mine = run.current;
    const rate = open.context.sampleRate;
    const joined = new Float32Array(open.length);
    let at = 0;
    for (const chunk of open.chunks) {
      joined.set(chunk, at);
      at += chunk.length;
    }
    release();
    const samples = resample(joined, rate, SAMPLE_RATE);
    if (samples.length < SAMPLE_RATE * MIN_SECONDS) {
      setNotice("That was too short to hear.", false);
      setPhase("idle");
      return;
    }
    await transcribe(samples, mine);
  };

  const record = async () => {
    const mine = ++run.current;
    setNotice(null);
    setPhase("starting");
    /* Made inside the click, so the browser lets it run. */
    const context = new AudioContext({ sampleRate: SAMPLE_RATE });
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      await context.audioWorklet.addModule("/dictation-worklet.js");
      await context.resume();
      if (run.current !== mine) throw new DOMException("cancelled", "AbortError");
      const node = new AudioWorkletNode(context, "dictation-capture", { numberOfOutputs: 1, outputChannelCount: [1] });
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      const open = { stream, context, node, analyser, chunks: [] as Float32Array[], length: 0 };
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        open.chunks.push(event.data);
        open.length += event.data.length;
        if (open.length >= MAX_SECONDS * context.sampleRate) void stop();
      };
      /* The worklet only runs while it feeds the output, so it goes there silently. */
      const silent = context.createGain();
      silent.gain.value = 0;
      const source = context.createMediaStreamSource(stream);
      source.connect(node);
      source.connect(analyser);
      node.connect(silent).connect(context.destination);
      capture.current = open;
      setPhase("recording");
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      void context.close().catch(() => {});
      if (run.current !== mine || !alive.current) return;
      setNotice(micError(error));
      setPhase("idle");
    }
  };

  /** Polls until the model is ready, then leaves the person to press the mic. */
  const watchDownload = async (mine: number) => {
    setPhase("downloading");
    try {
      for (;;) {
        const status = await readStatus();
        if (run.current !== mine || !alive.current) return;
        setProgress({ done: status.done, total: status.total });
        if (status.state === "ready") {
          setNotice("The speech model is ready. Press the mic to speak.", false);
          return setPhase("idle");
        }
        if (status.state === "missing") throw new Error(status.error ?? "The download failed.");
        await sleep(700);
      }
    } catch (error) {
      if (run.current !== mine || !alive.current) return;
      setNotice(error instanceof Error ? error.message : "The download failed.");
      setPhase("idle");
    }
  };

  const confirmDownload = async () => {
    claim(cancel);
    const mine = ++run.current;
    setNotice(null);
    setProgress({ done: 0, total: 0 });
    setPhase("downloading");
    try {
      const response = await fetch("/api/speech/download", { method: "POST" });
      if (!response.ok) throw new Error("Could not start the download.");
    } catch (error) {
      if (run.current !== mine || !alive.current) return;
      setNotice(error instanceof Error ? error.message : "Could not start the download.");
      return setPhase("idle");
    }
    await watchDownload(mine);
  };

  const toggle = async () => {
    if (phase === "recording") return stop();
    if (phase === "starting" || phase === "downloading" || phase === "consent") return cancel();
    if (phase === "transcribing") return;
    claim(cancel);
    const mine = ++run.current;
    setNotice(null);
    try {
      const status = await readStatus();
      if (run.current !== mine || !alive.current) return;
      if (status.state === "ready") return void record();
      if (status.state === "downloading") {
        setProgress({ done: status.done, total: status.total });
        return void watchDownload(mine);
      }
      setNotice(status.error);
      setPhase("consent");
    } catch (error) {
      if (run.current !== mine || !alive.current) return;
      setNotice(error instanceof Error ? error.message : "Could not check the speech model.");
    }
  };

  /* Escape cancels, wherever focus is, ahead of the field's own handlers. */
  useEffect(() => {
    if (phase === "idle") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [phase, cancel]);

  /** How loud the mic is right now, 0 to 1, for the bars on the button. Read every frame, so it never re-renders. */
  const level = useCallback(() => {
    const analyser = capture.current?.analyser;
    if (!analyser) return 0;
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    return Math.min(1, Math.sqrt(sum / samples.length) * 6);
  }, []);

  return { phase, progress, note, level, toggle, cancel, confirmDownload };
}

export type Dictation = ReturnType<typeof useDictation>;
