"use client";

import { useLayoutEffect, useRef, useState, type ReactNode, type TransitionEvent } from "react";
import clsx from "clsx";

/**
 * Places one shared pill behind the option of `group` that matches `selected` (a CSS selector), measured in
 * layout units so a parent mid-scale doesn't skew it. It measures again whenever the group or an option
 * changes size. Until the first measurement the group lacks data-placed, so the options can draw their own
 * selected look on the server-rendered frame.
 *
 * `slideTo` is the value a pointer choice is moving to; the pill animates only while it equals `value`, and
 * the hook clears it when that one move finishes, so a later resize or keyboard choice lands at once.
 */
export function usePill<T>(value: T, selected: string) {
  const groupRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const [slideTo, setSlideTo] = useState<T | null>(null);

  useLayoutEffect(() => {
    const group = groupRef.current;
    const pill = pillRef.current;
    if (!group || !pill) return;
    const place = () => {
      const target = group.querySelector<HTMLElement>(selected);
      if (!target) {
        delete group.dataset.placed;
        return;
      }
      /* Offsets round to whole pixels, so the boxes are read exactly and divided by any scale the group is under. */
      const box = group.getBoundingClientRect();
      const at = target.getBoundingClientRect();
      const scale = box.width / (parseFloat(getComputedStyle(group).width) || box.width) || 1;
      pill.style.setProperty("--pill-x", `${(at.left - box.left) / scale - group.clientLeft}px`);
      pill.style.setProperty("--pill-y", `${(at.top - box.top) / scale - group.clientTop}px`);
      pill.style.setProperty("--pill-width", `${at.width / scale}px`);
      pill.style.setProperty("--pill-height", `${at.height / scale}px`);
      group.dataset.placed = "";
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(group);
    for (const option of group.children) if (option !== pill) observer.observe(option);
    return () => observer.disconnect();
  }, [value, selected]);

  const sliding = slideTo !== null && slideTo === value;
  const settle = (event: TransitionEvent) => {
    if (event.target === pillRef.current && event.propertyName === "transform") setSlideTo(null);
  };

  return {
    groupRef,
    /** A pointer choice is moving the pill now. */
    sliding,
    pill: (
      <span
        ref={pillRef}
        aria-hidden
        data-slide={sliding || undefined}
        onTransitionEnd={settle}
        onTransitionCancel={settle}
        className="sliding-pill invisible rounded-sm bg-panel-raised shadow-chip group-data-[placed]/pill:visible"
      />
    ),
    /** Call with the value a choice moves to: slides for a pointer, lands at once for the keyboard. */
    choose(next: T, byPointer: boolean) {
      setSlideTo(byPointer ? next : null);
    },
  };
}

/** A row of mutually exclusive choices. An option with an icon shows only the icon, named by its label. `title` adds a tooltip. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; icon?: ReactNode; title?: string }[];
  value: T;
  onChange(value: T): void;
}) {
  const { groupRef, pill, choose } = usePill(value, '[aria-pressed="true"]');
  return (
    <div
      ref={groupRef}
      role="group"
      aria-label={label}
      className="group/pill relative flex h-7 shrink-0 items-center gap-0.5 rounded-md bg-tint p-0.5"
    >
      {pill}
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          aria-label={option.icon ? option.label : undefined}
          title={option.title ?? (option.icon ? option.label : undefined)}
          onClick={(event) => {
            if (option.value === value) return;
            /* A click from Enter or Space has no pointer press behind it, so its detail is 0. */
            choose(option.value, event.detail > 0);
            onChange(option.value);
          }}
          className={clsx(
            "press relative flex h-6 items-center justify-center rounded-sm text-label font-medium text-dim outline-none transition-[color,scale] duration-[var(--duration-fast)] hover:text-paper focus-visible:outline-2 focus-visible:outline-accent aria-pressed:bg-panel-raised aria-pressed:text-paper aria-pressed:shadow-chip group-data-[placed]/pill:aria-pressed:bg-transparent group-data-[placed]/pill:aria-pressed:shadow-none [&>svg]:size-3.5",
            option.icon ? "w-7" : "px-2.5",
          )}
        >
          {option.icon ?? option.label}
        </button>
      ))}
    </div>
  );
}
