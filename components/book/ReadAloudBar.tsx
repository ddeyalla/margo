"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Check, ChevronDown, Minus, Pause, Play, Plus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@ui-sdk/react/popover";
import { IconButton } from "@/components/ui";
import { READ_ALOUD_RATES, type ReadAloudRate } from "@/lib/shared/types";
import { VOICES, voiceOf, type VoiceId } from "@/lib/shared/voices";

interface VoiceModel {
  state: "missing" | "downloading" | "ready";
  done: number;
  total: number;
  error: string | null;
}

/** The reading voice's model: null until known, then polled while it downloads. */
function useVoiceModel() {
  const [model, setModel] = useState<VoiceModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const read = async () => {
      try {
        const response = await fetch("/api/voice", { cache: "no-store" });
        if (!response.ok) throw new Error("Could not check the voice.");
        const next = (await response.json()) as VoiceModel;
        if (!alive) return;
        setModel(next);
        setError(null);
        if (next.state === "downloading") timer = window.setTimeout(read, 700);
      } catch (failure) {
        if (alive) setError(failure instanceof Error ? failure.message : "Could not check the voice.");
      }
    };
    void read();
    /* Read again after asking for the download. */
    const onStart = () => void read();
    window.addEventListener("margo:voice-download", onStart);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("margo:voice-download", onStart);
    };
  }, []);
  const download = async () => {
    await fetch("/api/voice/download", { method: "POST" }).catch(() => null);
    window.dispatchEvent(new Event("margo:voice-download"));
  };
  return { model, error, download };
}

const megabytes = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

const rateLabel = (rate: number) => `${rate}×`;

/**
 * Read-along's controls, floating at the foot of the book: play and pause, the speed, and the voice. The voice
 * is Kokoro, running on this machine, so the book is never sent anywhere to be spoken. Its model is downloaded
 * once, when the reader asks.
 */
export function ReadAloudBar({
  playing,
  onPlaying,
  rate,
  onRate,
  voice,
  onVoice,
  shortcut,
  onClose,
}: {
  playing: boolean;
  onPlaying(playing: boolean): void;
  rate: ReadAloudRate;
  onRate(rate: ReadAloudRate): void;
  /** The chosen voice (one of VOICES), or null for the default. */
  voice: string | null;
  onVoice(voice: VoiceId): void;
  shortcut: string;
  onClose(): void;
}) {
  const { model, error, download } = useVoiceModel();
  const step = READ_ALOUD_RATES.indexOf(rate);

  return (
    <div
      role="toolbar"
      aria-label="Read aloud"
      className="animate-rise absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full bg-panel-raised p-1 text-label text-fog shadow-float"
    >
      {model?.state === "missing" ? (
        <span className="flex items-center gap-2 pl-3">
          <span>{model.error ?? "Read aloud uses a natural voice that runs on this computer."}</span>
          <button type="button" onClick={() => void download()} className="press rounded-full bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent/90">
            Download voice ({megabytes(model.total)})
          </button>
        </span>
      ) : model?.state === "downloading" ? (
        <span className="px-3 py-1.5 tabular-nums" aria-live="polite">
          Downloading the voice… {megabytes(model.done)} of {megabytes(model.total)}
        </span>
      ) : error && !model ? (
        <span className="px-3 py-1.5">{error}</span>
      ) : (
        <>
          <button
            type="button"
            aria-label={playing ? "Pause" : "Read aloud"}
            title={playing ? "Pause" : "Read aloud from here"}
            disabled={model === null}
            onClick={() => onPlaying(!playing)}
            className="press flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent transition-colors duration-[var(--duration-fast)] hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
          >
            {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4 translate-x-px" fill="currentColor" />}
          </button>
          <div className="flex items-center" role="group" aria-label="Speed">
            <IconButton size="sm" label="Slower" disabled={step <= 0} onClick={() => onRate(READ_ALOUD_RATES[step - 1])}>
              <Minus />
            </IconButton>
            <span aria-live="polite" className="w-10 text-center font-medium tabular-nums text-paper">
              {rateLabel(rate)}
            </span>
            <IconButton size="sm" label="Faster" disabled={step >= READ_ALOUD_RATES.length - 1} onClick={() => onRate(READ_ALOUD_RATES[step + 1])}>
              <Plus />
            </IconButton>
          </div>
          <VoicePicker voice={voice} onVoice={onVoice} />
        </>
      )}
      <IconButton size="sm" label={`Close read-aloud (${shortcut})`} onClick={onClose} className="mr-0.5">
        <X />
      </IconButton>
    </div>
  );
}

/** Three voices, so choosing takes one look. */
function VoicePicker({ voice, onVoice }: { voice: string | null; onVoice(voice: VoiceId): void }) {
  const [open, setOpen] = useState(false);
  const chosen = voiceOf(voice);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Voice"
        title="Voice"
        className="press flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-label text-fog outline-none transition-colors duration-[var(--duration-fast)] hover:bg-tint hover:text-paper focus-visible:outline-2 focus-visible:outline-accent data-[open]:bg-tint data-[open]:text-paper"
      >
        <span>{chosen.label}</span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0" />
      </PopoverTrigger>
      <PopoverContent side="top" align="center" sideOffset={8} collisionPadding={12} aria-label="Voices" className="pop z-[60] w-[180px] rounded-lg bg-panel-raised p-1 shadow-float outline-none">
        <div role="listbox" aria-label="Voices">
          {VOICES.map((v) => (
            <button
              key={v.id}
              type="button"
              role="option"
              aria-selected={chosen.id === v.id}
              onClick={() => {
                onVoice(v.id);
                setOpen(false);
              }}
              className={clsx(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-label transition-colors duration-[var(--duration-fast)] hover:bg-tint",
                chosen.id === v.id ? "text-paper" : "text-fog",
              )}
            >
              <Check aria-hidden className={clsx("size-3.5 shrink-0", chosen.id !== v.id && "invisible")} />
              <span className="flex-1">{v.label}</span>
              <span className="text-[11px] text-dim">{v.detail}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
