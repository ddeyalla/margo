"use client";

import { useRefreshOnReturn } from "@/components/book/useRefreshOnReturn";

/** Reloads the library when this window comes back, so it shows what another window changed. Renders nothing. */
export function RefreshOnReturn() {
  useRefreshOnReturn(null);
  return null;
}
