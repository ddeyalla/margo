"use client";

import clsx from "clsx";
import { Check, ChevronDown, Sparkles } from "lucide-react";
import {
  Menu,
  MenuContent,
  MenuGroupLabel,
  MenuItemIndicator,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "@ui-sdk/react/menu";
import type { ProviderId, ProviderInfo } from "@/lib/shared/types";

const STATUS_NOTE: Record<Exclude<ProviderInfo["status"], "ready">, string> = {
  "needs-auth": "Sign in required",
  missing: "Not installed",
  unavailable: "Unavailable",
};

const statusLine = (provider: ProviderInfo) =>
  provider.status === "ready"
    ? ["Ready", provider.version].filter(Boolean).join(" · ")
    : (provider.detail ?? STATUS_NOTE[provider.status]);

/** One pill naming the tutor in use. Providers that can't answer stay listed, disabled, with the reason. */
export function ProviderPicker({
  providers,
  current,
  onSelect,
}: {
  providers: ProviderInfo[] | null;
  current: ProviderId | null;
  onSelect(id: ProviderId): void;
}) {
  const active = providers?.find((p) => p.id === current) ?? null;
  const label = providers === null ? "Checking…" : (active?.label ?? "No tutor");

  return (
    <Menu>
      <MenuTrigger
        aria-label={`Tutor: ${label}`}
        className="press flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-full bg-tint px-2.5 text-[12px] text-fog outline-none transition-colors duration-[var(--duration-base)] hover:bg-tint-strong hover:text-paper focus-visible:outline-2 focus-visible:outline-accent data-[open]:bg-tint-strong data-[open]:text-paper"
      >
        <Sparkles size={12} aria-hidden className="shrink-0 text-dim" />
        <span className="truncate">{label}</span>
        <ChevronDown size={11} aria-hidden className="shrink-0 text-dim" />
      </MenuTrigger>
      <MenuContent
        side="bottom"
        align="end"
        sideOffset={6}
        collisionPadding={12}
        className="pop z-[60] w-[280px] max-w-[calc(100vw-24px)] rounded-lg bg-panel-raised p-1 shadow-float outline-none"
      >
        <MenuRadioGroup value={current} onValueChange={(value) => value && onSelect(value as ProviderId)}>
          <MenuGroupLabel className="px-2 pb-1 pt-1.5 text-[11px] text-dim">Tutor</MenuGroupLabel>
          {providers === null ? <p className="px-2 py-3 text-[12px] text-dim">Checking which tutors are available…</p> : null}
          {providers?.map((provider) => (
            <MenuRadioItem
              key={provider.id}
              value={provider.id}
              disabled={provider.status !== "ready"}
              closeOnSelect
              className="flex min-h-8 cursor-default select-none items-start gap-2 rounded-sm px-2 py-1.5 text-[12px] text-fog outline-none data-[highlighted]:bg-tint data-[highlighted]:text-paper data-[checked]:text-paper"
            >
              <span
                aria-hidden
                className={clsx(
                  "mt-[5px] size-1.5 shrink-0 rounded-full",
                  provider.status === "ready" ? "bg-live" : provider.status === "needs-auth" ? "bg-warn" : "bg-dim/60",
                )}
              />
              <span className={clsx("min-w-0 flex-1", provider.status !== "ready" && "opacity-60")}>
                <span className="block">{provider.label}</span>
                <span className="block text-[11px] leading-snug text-dim [overflow-wrap:anywhere]">{statusLine(provider)}</span>
              </span>
              <MenuItemIndicator className="mt-0.5 shrink-0">
                <Check size={13} aria-hidden />
              </MenuItemIndicator>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
