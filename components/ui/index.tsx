import type { ComponentProps, ReactNode } from "react";
import clsx from "clsx";

/*
 * The app's small pieces, built only from the tokens in globals.css. One rule runs through them: an edge is a
 * hairline (ring-line), never a shadow alone, so every surface, field and chip is drawn the same way in both
 * themes. Elevation is for what floats over something else: a card on a panel (chip), a bar over a canvas (float).
 */

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
        size === "sm" ? "h-7 gap-1.5 px-2.5 text-label [&>svg]:size-3.5" : "h-8 gap-2 px-3.5 text-body [&>svg]:size-4",
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

export { Segmented } from "./pill";

/* A field's edge and its states: the hairline darkens on hover and on focus, where the accent ring also shows. */
const fieldClass =
  "min-w-0 rounded-sm bg-panel text-paper outline-none ring-1 ring-inset ring-line transition-shadow duration-[var(--duration-fast)] placeholder:text-dim hover:ring-line-strong focus-visible:ring-line-strong disabled:opacity-50";

/** A one-line text field. `size` md for a form, sm for a field in a toolbar or list. */
export function Field({ className, size = "sm", ...props }: Omit<ComponentProps<"input">, "size"> & { size?: "sm" | "md" }) {
  return <input className={clsx(fieldClass, size === "sm" ? "h-7 px-2.5 text-label" : "h-8 px-3 text-label", className)} {...props} />;
}

/** A text field of several lines. */
export function TextArea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={clsx(fieldClass, "resize-none px-2.5 py-1.5 text-body leading-snug", className)} {...props} />;
}

/** A surface on a panel: a card, a row that stands out, a bar. `float` for one over a canvas or the book. */
export function Surface({ className, float, ...props }: ComponentProps<"div"> & { float?: boolean }) {
  return <div className={clsx("rounded-lg bg-panel-raised ring-1 ring-inset ring-line", float ? "shadow-float" : "shadow-chip", className)} {...props} />;
}

/** The bar across the top of a pane: its title, then its controls, above a hairline. */
export function PaneHeader({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("flex h-10 shrink-0 items-center gap-1 border-b border-line bg-panel px-1.5", className)}>{children}</div>;
}

/** A short upright hairline between groups of controls in a bar. */
export function Divider({ className }: { className?: string }) {
  return <span aria-hidden className={clsx("mx-1 h-4 w-px shrink-0 bg-line-strong", className)} />;
}

export function EmptyState({ icon, title, body, children }: { icon?: ReactNode; title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon ? <div className="mb-2 flex size-11 items-center justify-center rounded-lg bg-panel text-dim shadow-chip [&>svg]:size-5">{icon}</div> : null}
      <p className="text-body font-semibold text-paper">{title}</p>
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
