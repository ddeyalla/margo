"use client";

import { createContext, useContext, useEffect, useId, useState } from "react";
import { Shapes } from "lucide-react";
import { Button } from "@/components/ui";
import { diagramTitle, relatedBoard } from "@/lib/shared/boards";
import { OpenAsBoard, type DiagramBoards } from "@/components/board/WhiteboardSheet";
import { useBoardLink, type OpenBoard } from "@/components/board/link";
import { createStore, useStore } from "@/components/ui/store";
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
      {/* Every diagram can go on a whiteboard: the one open, the one about the same thing, or one of its own. */}
      {toBoard ? <ToBoard source={source} boards={toBoard} /> : null}
    </figure>
  );
}

const noBoard = createStore<OpenBoard | null>(null);

/**
 * Where a diagram goes on a board. It goes on the board that's open, or else the board about the same thing, as
 * suggestions that reuse what is already drawn; only a diagram no board is about gets a board of its own.
 */
function ToBoard({ source, boards }: { source: string; boards: DiagramBoards }) {
  const link = useBoardLink();
  const open = useStore(link?.open ?? noBoard, (board) => board);
  const target = open ? { id: open.id, title: open.title } : relatedBoard(source, boards.boards);
  const [state, setState] = useState<{ busy: true } | { done: string } | null>(null);
  const add = (boardId: string | null, title: string | null) => {
    setState({ busy: true });
    boards.add(source, boardId).then(
      (placed) =>
        setState(
          placed === null || !title
            ? null
            : {
                done: placed.added
                  ? `Added to “${title}”`
                  : placed.dropped
                    ? `“${title}” changed meanwhile, so nothing went on it. Try again.`
                    : `Already on “${title}”`,
              },
        ),
      (failure: unknown) => setState({ done: failure instanceof Error ? failure.message : "The diagram couldn't go on the board." }),
    );
  };
  return (
    <figcaption className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-3 py-1.5">
      <span className="flex min-w-40 flex-1 items-center gap-2">
        <Shapes className="size-3.5 shrink-0 text-dim" aria-hidden />
        <span className="min-w-0 truncate text-caption text-fog">{state && "done" in state ? state.done : diagramTitle(source)}</span>
      </span>
      {target ? (
        <span className="ml-auto flex min-w-0 shrink-0 items-center gap-1 whitespace-nowrap">
          <Button size="sm" variant="ghost" disabled={state !== null && "busy" in state} onClick={() => add(null, null)}>
            New board
          </Button>
          <Button size="sm" disabled={state !== null && "busy" in state} onClick={() => add(target.id, target.title)} title={`Adds what's new to “${target.title}”, as suggestions to keep or drop`}>
            <span className="max-w-48 truncate">Add to “{target.title}”</span>
          </Button>
        </span>
      ) : (
        <Button size="sm" variant="ghost" disabled={state !== null && "busy" in state} onClick={() => add(null, null)}>
          Open as whiteboard
        </Button>
      )}
    </figcaption>
  );
}
