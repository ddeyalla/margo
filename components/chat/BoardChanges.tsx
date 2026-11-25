"use client";

import { createContext, useContext } from "react";
import { Shapes } from "lucide-react";
import { Button, Spinner } from "@/components/ui";
import { useStore, createStore } from "@/components/ui/store";
import { useBoardLink, type AnswerChanges, type OpenBoard, type Placed } from "@/components/board/link";

/** The board changes in the answer being shown, for its ```board fence to draw as a card. */
export const AnswerBoard = createContext<AnswerChanges | null>(null);

const noBoard = createStore<OpenBoard | null>(null);
const nothingPlaced = createStore<Record<string, Placed>>({});

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function Card({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="my-2 flex items-center gap-2.5 rounded-lg bg-panel-raised py-2 pl-2.5 pr-2 shadow-chip ring-1 ring-inset ring-line">
      <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-md bg-tint text-fog">
        <Shapes className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 text-label leading-snug text-prose">{children}</span>
      {action}
    </div>
  );
}

/** The tutor's changes to a board, still being written. */
export function BoardChangesWriting() {
  return (
    <Card action={<Spinner />}>
      <span className="text-dim">Drawing on the board…</span>
    </Card>
  );
}

/**
 * Where an answer's board changes went. They land on the board as suggestions, kept or dropped there; the chat only
 * says where they are, and puts them on the board when they didn't go on their own (another board was open, or
 * the chat was opened later).
 */
export function BoardChanges() {
  const changes = useContext(AnswerBoard);
  const link = useBoardLink();
  const open = useStore(link?.open ?? noBoard, (board) => board);
  const placed = useStore(link?.placed ?? nothingPlaced, (all) => (changes ? all[changes.key] : undefined));
  if (!changes || !link) return null;
  const title = `“${changes.board.title}”`;
  if (typeof changes.ops === "string") return <Card>The tutor’s changes to {title} couldn’t be read.</Card>;
  const shown = open?.id === changes.board.id;
  if (placed) {
    return (
      <Card
        action={
          shown ? null : (
            <Button size="sm" variant="ghost" onClick={() => link.show(changes.board.id)}>
              Open the board
            </Button>
          )
        }
      >
        {placed.added ? (
          <>
            {plural(placed.added, "suggestion", "suggestions")} put on {title}
          </>
        ) : (
          <>The changes no longer fit {title}: it changed since you asked.</>
        )}
      </Card>
    );
  }
  return (
    <Card
      action={
        <Button size="sm" onClick={() => link.place(changes.key, changes.board, changes.ops as Exclude<typeof changes.ops, string>)}>
          Put on the board
        </Button>
      }
    >
      {plural(changes.ops.length, "change", "changes")} for {title}
    </Card>
  );
}
