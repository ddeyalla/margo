"use client";

import { createContext, useContext, useEffect, useId, useState } from "react";
import { Shapes } from "lucide-react";
import { Button } from "@/components/ui";
import { diagramTitle } from "@/lib/shared/boards";
import { OpenAsBoard } from "@/components/board/WhiteboardSheet";
import { drawnDiagram, renderDiagram } from "./mermaid";

/** Saves a diagram's source to the reader's notes, where the answer allows it. */
export const SaveDiagram = createContext<((source: string) => void) | null>(null);

const corner = "press rounded-xs bg-panel-raised px-1.5 py-0.5 text-caption text-fog shadow-chip hover:text-paper";

type Drawn = { source: string; svg: string } | { source: string; failed: true };

/** A Mermaid block drawn as SVG. Until it's drawn, and if it doesn't parse, the source shows as code. */
export function Diagram({ source, codeClass }: { source: string; codeClass: string }) {
  const id = `diagram-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const save = useContext(SaveDiagram);
  const toBoard = useContext(OpenAsBoard);
  /* A diagram drawn before shows on the first frame; the server has no document, so it starts as code there. */
  const [drawn, setDrawn] = useState<Drawn | null>(() => {
    const svg = typeof document === "undefined" ? undefined : drawnDiagram(source);
    return svg ? { source, svg } : null;
  });
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
    <figure className="group/diagram relative my-2 overflow-hidden rounded-md bg-ink/70">
      {/* Mermaid's strict mode sanitizes the SVG it returns: labels are escaped and scripts and links removed. A wide
          diagram scrolls inside its box; the button stays put in the corner. */}
      <div className="overflow-x-auto px-3 py-3">
        <div role="img" aria-label="Diagram" className="flex w-max min-w-full justify-center" dangerouslySetInnerHTML={{ __html: ready.svg }} />
      </div>
      {save ? (
        <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity duration-[var(--duration-fast)] focus-within:opacity-100 group-hover/diagram:opacity-100 has-[:disabled]:opacity-100">
          <button
            type="button"
            disabled={saved}
            onClick={() => {
              save(source);
              setSaved(true);
            }}
            className={corner}
          >
            {saved ? "Saved to notes" : "Save to notes"}
          </button>
        </div>
      ) : null}
      {/* Every diagram is a whiteboard waiting to be opened, as an artifact is: the reader's own to change and keep. */}
      {toBoard ? (
        <figcaption className="flex items-center gap-2 border-t border-line px-3 py-1.5">
          <Shapes className="size-3.5 shrink-0 text-dim" />
          <span className="min-w-0 flex-1 truncate text-caption text-fog">{diagramTitle(source)}</span>
          <Button size="sm" variant="ghost" onClick={() => toBoard(source)}>
            Open as whiteboard
          </Button>
        </figcaption>
      ) : null}
    </figure>
  );
}
