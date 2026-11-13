import type { ProviderId, ProviderInfo } from "@/lib/shared/types";
import { api } from "./api";
import { claude } from "./claude";
import { codex } from "./codex";
import type { Provider } from "./types";

/** Every tutor the app can use, in the order the default is picked. */
export const PROVIDERS: Record<ProviderId, Provider> = { claude, codex, api };
export const PROVIDER_ORDER: ProviderId[] = ["claude", "codex", "api"];

export const isProviderId = (value: unknown): value is ProviderId =>
  typeof value === "string" && Object.hasOwn(PROVIDERS, value);

/** Probing spawns CLIs, so results are kept briefly. The cache lives on globalThis because dev bundles each route separately. */
const PROBE_TTL_MS = 60_000;
const cache = ((globalThis as { [key: symbol]: unknown })[Symbol.for("rigg-learn.provider-probes")] ??= {
  at: 0,
  value: null as Promise<ProviderInfo[]> | null,
}) as { at: number; value: Promise<ProviderInfo[]> | null };

export const probeProviders = (fresh = false): Promise<ProviderInfo[]> => {
  if (!fresh && cache.value && Date.now() - cache.at < PROBE_TTL_MS) return cache.value;
  cache.at = Date.now();
  cache.value = Promise.all(
    PROVIDER_ORDER.map(async (id): Promise<ProviderInfo> => {
      const { label } = PROVIDERS[id];
      try {
        return { id, label, ...(await PROVIDERS[id].probe()) };
      } catch {
        return { id, label, status: "unavailable", detail: "Could not check this provider.", version: null };
      }
    }),
  );
  return cache.value;
};
