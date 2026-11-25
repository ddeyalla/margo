"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { CornerDownRight, Quote, X } from "lucide-react";
import clsx from "clsx";
import { createStore, type Store } from "@/components/ui/store";
import { placeLabel } from "@/lib/shared/place";
import { answerCitations, citationNote, MAX_QUOTES_PER_MESSAGE, sameAnchor } from "@/lib/shared/quotes";
import type { QuotedPassage } from "@/lib/shared/types";

/**
 * The passages quoted into the composer, waiting to go with the next message. One list for the chat, so a highlight
 * quoted from the book lands in whichever composer is showing.
 */
export type QuoteDraft = Store<QuotedPassage[]>;

export const createQuoteDraft = (): QuoteDraft => createStore<QuotedPassage[]>([]);

/** Adds a passage to the draft once. Says why not when it's already there or the message is full. */
export function addQuote(draft: QuoteDraft, quote: QuotedPassage): "added" | "already" | "full" {
  const current = draft.get();
  if (current.some((q) => sameAnchor(q.anchor, quote.anchor))) return "already";
  if (current.length >= MAX_QUOTES_PER_MESSAGE) return "full";
  draft.set([...current, quote]);
  return "added";
}

const chipClass = "flex min-w-0 max-w-full items-center gap-1.5 rounded-md bg-panel-hover py-1 pl-2 text-label ring-1 ring-inset ring-line";

/** The passages waiting in the composer. Each is one chip, removed whole. */
export function DraftQuotes({ quotes, onRemove }: { quotes: QuotedPassage[]; onRemove(index: number): void }) {
  return (
    <ul aria-label="Quoted passages" className="flex flex-col gap-1.5 px-3 pt-3">
      {quotes.map((quote, index) => (
        <li key={index} className={clsx(chipClass, "pr-0.5")} title={placeLabel(quote.chapterTitle, quote.anchor) ?? undefined}>
          <Quote className="size-3 shrink-0 text-dim" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-reading text-prose">{quote.text}</span>
          <button
            type="button"
            onClick={() => onRemove(index)}
            aria-label={`Remove quoted passage ${index + 1}`}
            title="Remove"
            className="press grid size-5 shrink-0 place-items-center rounded-sm text-dim transition-colors duration-[var(--duration-fast)] hover:bg-tint hover:text-paper focus-visible:outline-2 focus-visible:outline-accent"
          >
            <X className="size-3" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** What a citation can do in the thread on screen. */
export interface Citations {
  /** The thread's quoted passages; citation n is entry n - 1. */
  quotes: QuotedPassage[];
  /** Goes to a passage; resolves false when the book no longer has it there. */
  find(quote: QuotedPassage): Promise<boolean>;
  /** Saves a passage with the tutor's words about it as a note. */
  save(quote: QuotedPassage, body: string): void;
}

export const CitationsContext = createContext<Citations | null>(null);

/** Follows a passage, remembering when the book couldn't find it so the link says so. */
function useFind(quote: QuotedPassage | undefined) {
  const citations = useContext(CitationsContext);
  const [missing, setMissing] = useState(false);
  const find = () => {
    if (!citations || !quote) return;
    void citations.find(quote).then((found) => setMissing(!found));
  };
  return { citations, missing, find };
}

const missingNote = "Couldn't find this passage in the book. It may have changed since it was quoted.";

/** A passage the reader quoted, shown on their sent message. It leads back to the passage. */
function SentQuote({ quote, number }: { quote: QuotedPassage; number: number }) {
  const { missing, find } = useFind(quote);
  const place = placeLabel(quote.chapterTitle, quote.anchor);
  return (
    <li className="min-w-0 max-w-full">
      <button
        type="button"
        onClick={find}
        title={missing ? missingNote : place ? `Go to this passage · ${place}` : "Go to this passage"}
        className={clsx(chipClass, "press pr-2 text-left transition-colors duration-[var(--duration-fast)] hover:bg-panel-raised")}
      >
        <span className="shrink-0 tabular-nums text-caption text-dim">{number}</span>
        <span className="min-w-0 flex-1 truncate font-reading text-prose">{quote.text}</span>
        {missing ? <span className="shrink-0 text-caption text-warn">Not found</span> : null}
      </button>
    </li>
  );
}

/** A user message's quoted passages, right-aligned above its words, numbered as the tutor cites them. */
export function MessageQuotes({ quotes, first }: { quotes: QuotedPassage[]; first: number }) {
  return (
    <ul aria-label="Quoted passages" className="flex max-w-full flex-col items-end gap-1">
      {quotes.map((quote, index) => (
        <SentQuote key={index} quote={quote} number={first + index} />
      ))}
    </ul>
  );
}

/**
 * The tutor's words that rest on quoted passage `number`, as a link back to it. A number the thread has no passage
 * for, which the tutor made up, is left as plain words.
 */
export function CitationLink({ number, children }: { number: number; children: ReactNode }) {
  const citations = useContext(CitationsContext);
  const quote = citations?.quotes[number - 1];
  const { missing, find } = useFind(quote);
  if (!quote) return <>{children}</>;
  const place = placeLabel(quote.chapterTitle, quote.anchor);
  return (
    <a
      href={`#cite-${number}`}
      onClick={(event) => {
        event.preventDefault();
        find();
      }}
      title={missing ? missingNote : `Go to passage ${number}${place ? ` · ${place}` : ""}`}
      data-citation={number}
      className="cursor-pointer text-paper underline decoration-accent/60 decoration-dotted underline-offset-[3px] transition-colors hover:decoration-accent"
    >
      {children}
      <sup className={clsx("ml-px text-caption font-medium tabular-nums no-underline", missing ? "text-warn" : "text-accent")}>{number}</sup>
    </a>
  );
}

/** One passage an answer cites, under the answer: where it is, and a way to keep it with what the tutor said. */
function Source({ number, claims }: { number: number; claims: string[] }) {
  const quote = useContext(CitationsContext)?.quotes[number - 1];
  const [saved, setSaved] = useState(false);
  const follow = useFind(quote);
  const { citations } = follow;
  if (!citations || !quote) return null;
  const place = placeLabel(quote.chapterTitle, quote.anchor);
  return (
    <li className="group/source flex min-w-0 items-start gap-2">
      <span className="mt-px w-3 shrink-0 text-right tabular-nums text-caption text-accent">{number}</span>
      <button
        type="button"
        onClick={follow.find}
        title={follow.missing ? missingNote : "Go to this passage"}
        className="press min-w-0 flex-1 rounded-xs text-left transition-colors duration-[var(--duration-fast)] hover:text-paper"
      >
        <span className="line-clamp-2 font-reading text-label leading-snug text-fog">{quote.text}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-caption text-dim">
          <CornerDownRight className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{follow.missing ? "Not found in this copy of the book" : (place ?? "Go to passage")}</span>
        </span>
      </button>
      <button
        type="button"
        disabled={saved}
        onClick={() => {
          citations.save(quote, citationNote(claims));
          setSaved(true);
        }}
        className="press shrink-0 rounded-xs px-1.5 py-0.5 text-caption text-dim transition-colors duration-[var(--duration-fast)] hover:bg-tint hover:text-paper disabled:pointer-events-none"
      >
        {saved ? "Saved to notes" : "Save to notes"}
      </button>
    </li>
  );
}

/** The quoted passages an answer cites, listed under it. Nothing when it cites none. */
export function AnswerSources({ text }: { text: string }) {
  const citations = useContext(CitationsContext);
  if (!citations?.quotes.length) return null;
  const cited = answerCitations(text, citations.quotes.length);
  if (!cited.length) return null;
  return (
    <section aria-label="Passages cited" className="mt-2.5 border-t border-line pt-2">
      <ul className="flex flex-col gap-1.5">
        {cited.map(({ number, claims }) => (
          <Source key={number} number={number} claims={claims} />
        ))}
      </ul>
    </section>
  );
}
