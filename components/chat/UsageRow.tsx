"use client";

import { useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@ui-sdk/react/popover";
import type { ProviderId, Thread } from "@/lib/shared/types";
import { formatCost, formatTokens, threadUsage, type TurnRow } from "@/lib/shared/usage";

const PROVIDER_NAMES: Record<ProviderId, string> = { claude: "Claude Code", codex: "Codex", api: "API" };

const contextLabel = (tokens: number | null, window: number | null) => {
  if (tokens === null) return "Context —";
  return window ? `${formatTokens(tokens)} of ${formatTokens(window)} context` : `${formatTokens(tokens)} context`;
};

/**
 * The quiet line under the composer: how big the conversation is now, out of the model's window, and what the
 * thread has cost. Both come from what the providers reported; a figure they didn't give shows as "—". Clicking
 * it lists every answer's tokens.
 */
export function UsageRow({ thread }: { thread: Thread }) {
  const usage = useMemo(() => threadUsage(thread), [thread]);
  if (!thread.messages.some((message) => message.role === "assistant")) return null;
  const { latest, costUsd, listPriced } = usage;
  const cost = costUsd === null ? "Cost —" : `${formatCost(costUsd)}${listPriced ? " at API rates" : ""}`;

  return (
    <Popover>
      <PopoverTrigger
        title="What this thread has used"
        className="press -mt-1.5 mb-1.5 ml-4 mr-auto flex max-w-[calc(100%-2rem)] items-center gap-1.5 rounded-xs px-1 text-caption tabular-nums text-dim outline-none transition-colors duration-[var(--duration-fast)] hover:text-fog focus-visible:outline-2 focus-visible:outline-accent data-[open]:text-fog"
      >
        <span className="truncate">{contextLabel(latest?.contextTokens ?? null, latest?.contextWindow ?? null)}</span>
        <span aria-hidden>·</span>
        <span className="truncate">{cost}</span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={12}
        aria-label="Usage by answer"
        className="pop z-[60] flex max-h-[60vh] w-[320px] max-w-[calc(100vw-24px)] flex-col gap-2 overflow-y-auto rounded-lg bg-panel-raised p-3 shadow-float outline-none"
      >
        <UsageDetail usage={usage} />
      </PopoverContent>
    </Popover>
  );
}

function UsageDetail({ usage }: { usage: ReturnType<typeof threadUsage> }) {
  const { rows, unreported, listPriced, summaries } = usage;
  const sessionTotals = rows.some((row) => row.usage.scope === "session");
  const summaryCosts = summaries.flatMap((summary) => (summary.costUsd === null ? [] : [summary.costUsd]));
  return (
    <>
      <p className="text-label text-paper">Usage by answer</p>
      {rows.length ? (
        <ol className="flex flex-col divide-y divide-line">
          {rows.map((row) => (
            <UsageLine key={row.index} row={row} />
          ))}
        </ol>
      ) : null}
      {summaries.length ? (
        <p className="flex items-baseline gap-2 text-caption tabular-nums">
          <span className="flex-1 text-fog">
            {summaries.length === 1 ? "1 summary" : `${summaries.length} summaries`} of earlier turns
          </span>
          <span className="text-fog">{summaryCosts.length ? formatCost(summaryCosts.reduce((sum, cost) => sum + cost, 0)) : "—"}</span>
        </p>
      ) : null}
      {unreported ? (
        <p className="text-caption leading-relaxed text-dim">
          {unreported === 1 ? "1 answer has" : `${unreported} answers have`} no usage: the tutor didn&rsquo;t report it, or it was saved before
          usage was kept.
        </p>
      ) : null}
      {sessionTotals ? (
        <p className="text-caption leading-relaxed text-dim">Codex reports a running total for its session. Each Codex line is the change since the one before.</p>
      ) : null}
      {listPriced ? <p className="text-caption leading-relaxed text-dim">Your Claude plan pays for Claude Code. Its cost is what the same tokens would cost on the API.</p> : null}
    </>
  );
}

function UsageLine({ row }: { row: TurnRow }) {
  const { usage, tokens } = row;
  return (
    <li className="flex flex-col gap-0.5 py-1.5 text-caption tabular-nums">
      <span className="flex items-baseline gap-2">
        <span className="text-fog">Answer {row.answer}</span>
        <span className="min-w-0 flex-1 truncate text-dim">{usage.model ?? PROVIDER_NAMES[usage.provider]}</span>
        <span className="text-fog">{row.costUsd === null ? "—" : formatCost(row.costUsd)}</span>
      </span>
      <span className="text-dim">
        {formatTokens(tokens.input + tokens.cacheRead + tokens.cacheWrite)} in
        {tokens.cacheRead ? ` (${formatTokens(tokens.cacheRead)} cached)` : ""} · {formatTokens(tokens.output)} out
      </span>
    </li>
  );
}
