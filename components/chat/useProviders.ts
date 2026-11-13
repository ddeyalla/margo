"use client";

import { useEffect, useState } from "react";
import { patchSettings } from "@/lib/client/api";
import type { ProviderId, ProviderInfo } from "@/lib/shared/types";

/**
 * The tutor providers and the one in use: the saved choice while it's ready,
 * else the first ready one in the server's order (claude, codex, api).
 */
export function useProviders(saved: ProviderId | null) {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [chosen, setChosen] = useState(saved);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/providers")
      .then((response) => (response.ok ? (response.json() as Promise<ProviderInfo[]>) : []))
      .catch(() => [])
      .then((list) => {
        if (!cancelled) setProviders(list);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = (id: ProviderId | null) => providers?.some((p) => p.id === id && p.status === "ready") ?? false;
  const current = providers === null ? null : ready(chosen) ? chosen : (providers.find((p) => p.status === "ready")?.id ?? null);

  const choose = (id: ProviderId) => {
    setChosen(id);
    void patchSettings({ provider: id });
  };

  /** Why nothing can be sent yet, or null when a tutor is ready. */
  const unavailable =
    providers === null ? "Checking which tutors are available…" : current === null ? "No tutor is available. Open the tutor menu to see why." : null;

  return { providers, current, choose, unavailable };
}
