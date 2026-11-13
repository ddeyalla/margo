import { CircleAlert, FileText } from "lucide-react";
import type { VaultStatus } from "@/lib/shared/types";

const baseName = (file: string) => file.split(/[\\/]/).pop() ?? file;

/** Where the markdown copy of this book's highlights and notes went, at the foot of the Highlights and Notes tabs. */
export function VaultLine({ vault }: { vault: VaultStatus | null }) {
  if (!vault) return null;
  if (vault.state === "failed") {
    return (
      <div role="alert" className="flex shrink-0 items-start gap-2 px-4 py-2.5 text-[11px] leading-relaxed text-dim">
        <CircleAlert className="mt-px size-3 shrink-0 text-warn" aria-hidden />
        <p className="min-w-0 [overflow-wrap:anywhere]">
          <span className="text-fog">Saved in the app, but not copied to your notes folder.</span> {vault.error}
        </p>
      </div>
    );
  }
  return (
    <p
      title={vault.state === "written" ? vault.file : undefined}
      className="flex shrink-0 items-center gap-2 px-4 py-2.5 text-[11px] text-dim"
    >
      <FileText className="size-3 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">
        {vault.state === "written" ? (
          <>
            Copied to <span className="text-fog">{baseName(vault.file)}</span>
          </>
        ) : (
          "Set NOTES_DIR in .env.local to keep a markdown copy."
        )}
      </span>
    </p>
  );
}
