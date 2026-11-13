import type { ImageMediaType, ProviderId, ProviderStatus } from "@/lib/shared/types";

/** An image's bytes as base64, the form both Anthropic formats take. */
export interface TutorImage {
  mediaType: ImageMediaType;
  data: string;
}

export interface TutorMessage {
  role: "user" | "assistant";
  content: string;
  /** The reader's images for this message, in the order they attached them. */
  images: TutorImage[];
}

/** One request to a provider: the conversation so far, ending with the new user message. */
export interface TutorTurn {
  system: string;
  messages: TutorMessage[];
  /** The provider's own session to resume, when the thread already has one with this provider. */
  sessionId: string | null;
  model: string | null;
}

export type TutorEvent =
  | { type: "text"; delta: string }
  | { type: "session"; id: string }
  | { type: "error"; message: string };

export interface ProviderProbe {
  status: ProviderStatus;
  detail: string | null;
  version: string | null;
}

export interface Provider {
  id: ProviderId;
  label: string;
  probe(): Promise<ProviderProbe>;
  run(turn: TutorTurn, signal: AbortSignal): AsyncIterable<TutorEvent>;
}
