"use client";

import { createContext, useContext, useEffect, useId, useState } from "react";
import { renderDiagram } from "./mermaid";

/** Saves a diagram's source to the reader's notes, where the answer allows it. */
export const SaveDiagram = createContext<((source: string) => void) | null>(null);

type Drawn = { source: string; svg: string } | { source: string; failed: true };

/** A Mermaid block drawn as SVG. Until it's drawn, and if it doesn't parse, the source shows as code. */
export function Diagram({ source, codeClass }: { source: string; codeClass: string }) {
  const id = `diagram-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const save = useContext(SaveDiagram);
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let current = true;
    renderDiagram(id, source).then(
      (svg) => current && setDrawn({ source, svg }),
      () => current && setDrawn({ source, failed: true }),
    );
    return () => {
      current = false;
    };
  }, [id, source]);

  const ready = drawn?.source === source ? drawn : null;
  if (!ready || "failed" in ready) {
    return (
      <pre className={codeClass} data-diagram={ready ? "failed" : "drawing"}>
        <code>{source}</code>
      </pre>
    );
  }
  return (
    <figure className="group/diagram relative my-2">
      {/* Mermaid's strict mode sanitizes the SVG it returns: labels are escaped and scripts and links removed. A wide
          diagram scrolls inside its box; the button stays put in the corner. */}
      <div className="overflow-x-auto rounded-md bg-ink/70 px-3 py-3">
        <div role="img" aria-label="Diagram" className="flex w-max min-w-full justify-center" dangerouslySetInnerHTML={{ __html: ready.svg }} />
      </div>
      {save ? (
        <button
          type="button"
          disabled={saved}
          onClick={() => {
            save(source);
            setSaved(true);
          }}
          className="press absolute right-1.5 top-1.5 rounded-xs bg-panel-raised px-1.5 py-0.5 text-[11px] text-fog opacity-0 shadow-chip transition-opacity duration-[var(--duration-fast)] hover:text-paper focus-visible:opacity-100 group-hover/diagram:opacity-100 disabled:opacity-100"
        >
          {saved ? "Saved to notes" : "Save to notes"}
        </button>
      ) : null}
    </figure>
  );
}
