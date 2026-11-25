"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Check, ChevronDown, Minus, Pause, Play, Plus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@ui-sdk/react/popover";
import { localVoices } from "@/components/reader/narrator";
import { IconButton } from "@/components/ui";
import { READ_ALOUD_RATES, type ReadAloudRate } from "@/lib/shared/types";

/** This machine's on-device voices, kept current as the browser loads them. Null until the list is known. */
function useVoices() {
  /* Without speech synthesis at all there is nothing to wait for. The bar only renders in the browser. */
  const [voices, setVoices] = useState<SpeechSynthesisVoice[] | null>(() =>
    typeof speechSynthesis === "undefined" ? [] : speechSynthesis.getVoices().length ? localVoices() : null,
  );
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    const read = () => {
      const all = speechSynthesis.getVoices();
      /* Chromium lists no voices at all until it has asked the system; an empty list is not yet an answer. */
      if (all.length) setVoices(localVoices());
    };
    speechSynthesis.addEventListener("voiceschanged", read);
    /* A machine with no voices never fires voiceschanged. */
    const giveUp = window.setTimeout(() => setVoices((known) => known ?? localVoices()), 1500);
    return () => {
      speechSynthesis.removeEventListener("voiceschanged", read);
      clearTimeout(giveUp);
    };
  }, []);
  return voices;
}

const rateLabel = (rate: number) => `${rate}×`;

/**
 * Read-along's controls, floating at the foot of the book: play and pause, the speed, and the voice. Only
 * on-device voices are offered, so the book is never sent anywhere to be spoken.
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
  /** The chosen voice's voiceURI, or null to match the book's language. */
  voice: string | null;
  onVoice(voice: string | null): void;
  shortcut: string;
  onClose(): void;
}) {
  const voices = useVoices();
  const step = READ_ALOUD_RATES.indexOf(rate);
  const none = voices !== null && voices.length === 0;

  return (
    <div
      role="toolbar"
      aria-label="Read aloud"
      className="animate-rise absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full bg-panel-raised p-1 text-label text-fog shadow-float"
    >
      {none ? (
        <span className="px-3 py-1.5">No on-device voices on this computer. Add one in System Settings › Accessibility › Spoken Content.</span>
      ) : (
        <>
          <button
            type="button"
            aria-label={playing ? "Pause" : "Read aloud"}
            title={playing ? "Pause" : "Read aloud from here"}
            disabled={voices === null}
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
          <VoicePicker voices={voices ?? []} voice={voice} onVoice={onVoice} />
        </>
      )}
      <IconButton size="sm" label={`Close read-aloud (${shortcut})`} onClick={onClose} className="mr-0.5">
        <X />
      </IconButton>
    </div>
  );
}

/** The voices in the app's language come first; the rest follow under their languages' codes. */
function VoicePicker({ voices, voice, onVoice }: { voices: SpeechSynthesisVoice[]; voice: string | null; onVoice(voice: string | null): void }) {
  const [open, setOpen] = useState(false);
  const { mine, others } = useMemo(() => {
    const base = (lang: string) => lang.toLowerCase().split("-")[0];
    const own = base(typeof navigator === "undefined" ? "en" : navigator.language);
    const byName = (a: SpeechSynthesisVoice, b: SpeechSynthesisVoice) => a.name.localeCompare(b.name);
    return {
      mine: voices.filter((v) => base(v.lang) === own).sort(byName),
      others: voices.filter((v) => base(v.lang) !== own).sort((a, b) => a.lang.localeCompare(b.lang) || byName(a, b)),
    };
  }, [voices]);
  const chosen = voice ? voices.find((v) => v.voiceURI === voice) : undefined;
  const choose = (next: string | null) => {
    onVoice(next);
    setOpen(false);
  };

  const option = (key: string, label: string, detail: string | null, selected: boolean, value: string | null) => (
    <button
      key={key}
      type="button"
      role="option"
      aria-selected={selected}
      onClick={() => choose(value)}
      className={clsx(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-label transition-colors duration-[var(--duration-fast)] hover:bg-tint",
        selected ? "text-paper" : "text-fog",
      )}
    >
      <Check aria-hidden className={clsx("size-3.5 shrink-0", !selected && "invisible")} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail ? <span className="shrink-0 text-[11px] text-dim">{detail}</span> : null}
    </button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Voice"
        title="Voice"
        className="press flex h-7 max-w-[160px] shrink-0 items-center gap-1 rounded-full px-2.5 text-label text-fog outline-none transition-colors duration-[var(--duration-fast)] hover:bg-tint hover:text-paper focus-visible:outline-2 focus-visible:outline-accent data-[open]:bg-tint data-[open]:text-paper"
      >
        <span className="truncate">{chosen?.name ?? "Automatic"}</span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0" />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        collisionPadding={12}
        aria-label="Voices on this computer"
        className="pop z-[60] flex max-h-[min(420px,60vh)] w-[260px] flex-col overflow-y-auto rounded-lg bg-panel-raised p-1 shadow-float outline-none"
      >
        <div role="listbox" aria-label="Voices on this computer">
          {option("auto", "Automatic", "book's language", !chosen, null)}
          {mine.length ? <div className="my-1 border-t border-line" /> : null}
          {mine.map((v) => option(v.voiceURI, v.name, v.lang, chosen === v, v.voiceURI))}
          {others.length ? <p className="mt-1 border-t border-line px-2 pb-1 pt-2 text-[11px] text-dim">Other languages</p> : null}
          {others.map((v) => option(v.voiceURI, v.name, v.lang, chosen === v, v.voiceURI))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
