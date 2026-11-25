/** Session lengths offered in the reader, in minutes. */
export const FOCUS_CHOICES = [15, 25, 30, 45, 60] as const;
export const DEFAULT_FOCUS_MINUTES = 30;
export const MIN_FOCUS_MINUTES = 5;
export const MAX_FOCUS_MINUTES = 180;

export const clampFocusMinutes = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= MIN_FOCUS_MINUTES && value <= MAX_FOCUS_MINUTES ? value : null;

/**
 * What blocking a session gets from Three, the focus app that owns the block list. "on" counts what is
 * enforced: websites only reach Chrome once Three's extension is connected there.
 */
export type FocusBlocking =
  | { state: "on"; sites: number; apps: number; chromeConnected: boolean }
  | { state: "off"; reason: string };

/** A started session. Three's own end time when it runs the session, so both clocks agree; null otherwise. */
export interface FocusStart {
  sessionId: string | null;
  endsAt: string | null;
  blocking: FocusBlocking;
}

/** One line on what a session will or did block, for the picker and the clock. */
export const blockingLine = (blocking: FocusBlocking): string => {
  if (blocking.state === "off") return blocking.reason;
  const { sites, apps, chromeConnected } = blocking;
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  const siteText = sites && chromeConnected ? plural(sites, "site") : null;
  const appText = apps ? plural(apps, "app") : null;
  const blocked = [siteText, appText].filter(Boolean).join(" and ");
  const chromeNote = sites && !chromeConnected ? " Websites aren’t blocked until Chrome is connected to Three." : "";
  return blocked ? `Blocks ${blocked} through Three.${chromeNote}` : `Nothing is blocked.${chromeNote}`;
};
