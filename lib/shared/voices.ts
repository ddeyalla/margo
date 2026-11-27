/**
 * The reading voices. Kokoro v1.0 ships 54; three are offered, so choosing takes one look. Each is a speaker
 * of the kokoro-multi-lang-v1_0 model, by its id in that model, with the lexicon its accent reads words with.
 */
export const VOICES = [
  { id: "heart", label: "Heart", detail: "US", speaker: 3, lexicon: "us" },
  { id: "michael", label: "Michael", detail: "US", speaker: 16, lexicon: "us" },
  { id: "emma", label: "Emma", detail: "UK", speaker: 21, lexicon: "gb" },
] as const;

export type VoiceId = (typeof VOICES)[number]["id"];

export const DEFAULT_VOICE: VoiceId = "heart";

export const isVoiceId = (value: unknown): value is VoiceId => VOICES.some((voice) => voice.id === value);

/** The voice for a saved setting. A setting from before these voices (a system voice's URI) gets the default. */
export const voiceOf = (id: unknown) => VOICES.find((voice) => voice.id === id) ?? VOICES[0];
