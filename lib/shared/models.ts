import type { ProviderId } from "./types";

export interface TutorModel {
  id: string;
  label: string;
  /** One line on when to pick it. */
  note: string;
}

const CLAUDE_MODELS: TutorModel[] = [
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", note: "Fast and capable; enough for most reading" },
  { id: "claude-opus-5-5", label: "Opus 5.5", note: "Deeper reasoning for hard material" },
  { id: "claude-fable-5-2", label: "Fable 5.2", note: "The most capable, and the most expensive" },
];

/**
 * The models the reader can choose for each tutor. A provider with no list (Codex) keeps its own default. The API
 * list matches the price table in `lib/server/tutor/api.ts`, so every choice there has a cost.
 */
export const TUTOR_MODELS: Partial<Record<ProviderId, TutorModel[]>> = {
  claude: CLAUDE_MODELS,
  api: CLAUDE_MODELS,
};

/** What runs when the reader hasn't chosen: the label shown for the "default" choice. */
export const DEFAULT_MODEL_LABEL: Partial<Record<ProviderId, string>> = {
  claude: "Claude Code's default",
  api: "Default (Sonnet 5.5)",
};

export const isTutorModel = (provider: ProviderId, model: unknown): model is string =>
  typeof model === "string" && (TUTOR_MODELS[provider]?.some((m) => m.id === model) ?? false);
