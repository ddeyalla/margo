import type { ProviderId } from "@/lib/shared/types";
import { readSettings } from "../settings";
import { CODEX_DEFAULT_MODEL } from "../tutor/codex";
import { PROVIDERS, probeProviders } from "../tutor/providers";
import type { Provider } from "../tutor/types";

/**
 * The model that checks questions and grades answers, per tutor. Checking is many small calls, so it runs on the
 * cheapest model that passed the evaluation set in `tests/eval/` (numbers in `scripts/check-eval/README.md`), not
 * on the model the reader chose for the tutor. Codex keeps its default: its account couldn't be run when the set
 * was scored.
 */
export const CHECK_MODEL: Record<ProviderId, string> = {
  claude: "claude-haiku-5-5",
  api: "claude-haiku-5-5",
  codex: CODEX_DEFAULT_MODEL,
};

export interface Checker {
  provider: Provider;
  model: string;
}

export const checkerFor = (id: ProviderId): Checker => ({ provider: PROVIDERS[id], model: CHECK_MODEL[id] });

/** The checker for a caller that named no tutor: the reader's own choice, else the first tutor that is ready. */
export const defaultChecker = async (): Promise<Checker | null> => {
  const chosen = (await readSettings()).provider;
  if (chosen) return checkerFor(chosen);
  const ready = (await probeProviders()).find((provider) => provider.status === "ready");
  return ready ? checkerFor(ready.id) : null;
};
