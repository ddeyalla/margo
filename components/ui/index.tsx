import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import clsx from "clsx";

/* Small controlled pieces adapted from rigg-video's primitives. They use only
   the tokens in globals.css and touch only colour, opacity and transform. */

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

type ButtonVariant = "primary" | "ghost" | "outline";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent font-semibold text-ink hover:bg-white active:bg-accent/90",
  ghost: "text-fog hover:bg-white/[0.06] hover:text-paper active:bg-panel-hover",
  outline: "bg-panel-raised text-fog hover:bg-panel-hover hover:text-paper",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" }
>(function Button({ className, variant = "outline", size = "sm", type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(
        "press inline-flex select-none items-center justify-center font-medium transition-[color,background-color,scale,opacity] duration-[var(--duration-fast)] ease-out disabled:pointer-events-none disabled:opacity-40 [&>svg]:shrink-0",
        focusRing,
        buttonVariants[variant],
        size === "sm" ? "h-7 gap-1.5 rounded-sm px-2.5 text-label [&>svg]:size-3.5" : "h-8 gap-2 rounded-md px-3 text-[13px] [&>svg]:size-4",
        className,
      )}
      {...props}
    />
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }
>(function IconButton({ className, label, active, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={clsx(
        "press inline-flex size-7 shrink-0 items-center justify-center rounded-sm transition-[color,background-color,scale,opacity] duration-[var(--duration-fast)] ease-out disabled:pointer-events-none disabled:opacity-40 [&>svg]:size-4 [&>svg]:shrink-0",
        focusRing,
        active ? "bg-panel-hover text-paper" : "text-dim hover:bg-white/[0.06] hover:text-paper",
        className,
      )}
      {...props}
    />
  );
});

export function EmptyState({ icon, title, body, children }: { icon?: ReactNode; title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon ? <div className="mb-1 text-dim/70 [&>svg]:size-5">{icon}</div> : null}
      <p className="text-[13px] font-medium text-fog">{title}</p>
      {body ? <p className="max-w-[30ch] text-label leading-relaxed text-dim">{body}</p> : null}
      {children}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 items-center rounded-xs bg-white/[0.06] px-1.5 font-sans text-label leading-none text-fog">
      {children}
    </kbd>
  );
}
