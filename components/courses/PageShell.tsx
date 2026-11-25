import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/** The header and column the course pages share with the library. */
export function PageShell({ children, width = "max-w-[760px]" }: { children: React.ReactNode; width?: string }) {
  return (
    <div className="min-h-full bg-ink">
      <header className="sticky top-0 z-10 flex h-12 items-center gap-2 bg-ink/80 px-3 backdrop-blur-md">
        <Link href="/" className="press flex h-7 items-center gap-2 rounded-full px-2.5 text-body font-medium text-fog hover:bg-tint hover:text-paper">
          <ArrowLeft aria-hidden className="size-3.5 text-dim" />
          Library
        </Link>
      </header>
      <main className={`mx-auto w-full ${width} px-6 pb-24 pt-8`}>{children}</main>
    </div>
  );
}
