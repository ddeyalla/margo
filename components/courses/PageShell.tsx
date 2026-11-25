import Link from "next/link";
import { Library as LibraryIcon } from "lucide-react";

/** The header and column the course pages share with the library. */
export function PageShell({ children, width = "max-w-[760px]" }: { children: React.ReactNode; width?: string }) {
  return (
    <div className="min-h-full bg-ink">
      <header className="sticky top-0 z-10 flex h-12 items-center gap-2 bg-ink/80 px-3 backdrop-blur-md">
        <Link href="/" className="press flex h-7 items-center gap-2 rounded-full bg-panel-raised px-3 text-[13px] font-semibold text-paper shadow-chip">
          <LibraryIcon aria-hidden className="size-3.5 text-dim" />
          rigg learn
        </Link>
      </header>
      <main className={`mx-auto w-full ${width} px-6 pb-24 pt-8`}>{children}</main>
    </div>
  );
}
