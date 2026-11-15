import type { ComponentProps, ReactNode } from "react";
import clsx from "clsx";

/* Small controlled pieces that use only the tokens in globals.css. */

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function Spinner({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" fill="none" className={clsx("size-[1em] shrink-0 animate-spin", className)}>
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
      <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

type ButtonVariant = "primary" | "ghost" | "outline" | "danger";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "rounded-full bg-accent font-semibold text-on-accent hover:bg-accent/90",
  ghost: "rounded-sm text-fog hover:bg-tint hover:text-paper active:bg-tint-strong",
  outline: "rounded-sm bg-panel-raised text-paper shadow-chip hover:bg-panel-hover",
  danger: "rounded-sm bg-danger/15 font-semibold text-danger hover:bg-danger/25",
};

export function Button({
  className,
  variant = "outline",
  size = "sm",
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return (
    <button
      type={type}
      className={clsx(
        "press inline-flex select-none items-center justify-center font-medium transition-[color,background-color,scale,opacity] duration-[var(--duration-fast)] ease-out disabled:pointer-events-none disabled:opacity-40 [&>svg]:shrink-0",
        focusRing,
        buttonVariants[variant],
        size === "sm" ? "h-7 gap-1.5 px-2.5 text-label [&>svg]:size-3.5" : "h-8 gap-2 px-3.5 text-[13px] [&>svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export function IconButton({
  className,
  label,
  active,
  size = "md",
  type = "button",
  ...props
}: ComponentProps<"button"> & { label: string; active?: boolean; size?: "sm" | "md" }) {
  return (
    <button
      type={type}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={clsx(
        "press inline-flex shrink-0 items-center justify-center rounded-sm transition-[color,background-color,scale,opacity] duration-[var(--duration-fast)] ease-out disabled:pointer-events-none disabled:opacity-40 [&>svg]:shrink-0",
        size === "sm" ? "size-6 [&>svg]:size-3.5" : "size-7 [&>svg]:size-4",
        focusRing,
        active ? "bg-panel-raised text-paper shadow-chip" : "text-dim hover:bg-tint hover:text-paper",
        className,
      )}
      {...props}
    />
  );
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
  return (
    <div role="group" aria-label={label} className="flex h-7 shrink-0 items-center gap-0.5 rounded-md bg-tint p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          aria-label={option.icon ? option.label : undefined}
          title={option.title ?? (option.icon ? option.label : undefined)}
          onClick={() => option.value !== value && onChange(option.value)}
          className={clsx(
            "press flex h-6 items-center justify-center rounded-sm text-label font-medium text-dim outline-none transition-[color,background-color,box-shadow] duration-[var(--duration-fast)] hover:text-paper focus-visible:outline-2 focus-visible:outline-accent aria-pressed:bg-panel-raised aria-pressed:text-paper aria-pressed:shadow-chip [&>svg]:size-3.5",
            option.icon ? "w-7" : "px-2.5",
          )}
        >
          {option.icon ?? option.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, body, children }: { icon?: ReactNode; title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon ? <div className="mb-2 flex size-11 items-center justify-center rounded-lg bg-panel text-dim shadow-chip [&>svg]:size-5">{icon}</div> : null}
      <p className="text-[13px] font-semibold text-paper">{title}</p>
      {body ? <p className="max-w-[30ch] text-label leading-relaxed text-dim">{body}</p> : null}
      {children}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 items-center rounded-xs bg-tint px-1.5 font-sans text-label leading-none text-fog">
      {children}
    </kbd>
  );
}
