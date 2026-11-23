"use client";

import { useEffect, useState } from "react";
import { patchSettings } from "@/lib/client/api";
import type { AppSettings, ProviderId, ProviderInfo } from "@/lib/shared/types";

/**
 * The tutor providers and the one in use: the saved choice while it's ready,
 * else the first ready one in the server's order. Each tutor's chosen model, or none for its default.
 */
export function useProviders(saved: ProviderId | null, savedModels: AppSettings["models"]) {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [chosen, setChosen] = useState(saved);
  const [models, setModels] = useState(savedModels);

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

  /** Sets a tutor's model, or null for its default. Takes effect from the next answer. */
  const chooseModel = (id: ProviderId, model: string | null) => {
    setModels((current) => {
      const next = { ...current };
      if (model === null) delete next[id];
      else next[id] = model;
      return next;
    });
    void patchSettings({ models: { [id]: model } as AppSettings["models"] });
  };

  /** Why nothing can be sent yet, or null when a tutor is ready. */
  const unavailable =
    providers === null ? "Checking which tutors are available…" : current === null ? "No tutor is available. Open the tutor menu to see why." : null;

  return { providers, current, choose, models, chooseModel, unavailable };
}
