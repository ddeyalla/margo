import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowRight, Sprout } from "lucide-react";
import { PageShell } from "@/components/courses/PageShell";
import { bookHref } from "@/components/search/arrival";
import { EmptyState, Spinner } from "@/components/ui";
import { readLedger } from "@/lib/server/ledger";
import { findBook } from "@/lib/server/library";
import { readBookState } from "@/lib/server/store";
import { UNTITLED_SECTION } from "@/lib/shared/annotations";
import { chapterCounts, ledgerItems, totals, weakest, type ChapterCounts, type KnowledgeState, type LedgerItem } from "@/lib/shared/ledger";
import { placeLabel } from "@/lib/shared/place";
import type { BookId } from "@/lib/shared/types";

export default function KnowledgePage({ params }: PageProps<"/book/[bookId]/knowledge">) {
  return (
    <PageShell>
      <Suspense fallback={<Spinner />}>
        <Knowledge params={params} />
      </Suspense>
    </PageShell>
  );
}

const STATES: { state: KnowledgeState; label: string; tone: string; meaning: string }[] = [
  { state: "held", label: "Held", tone: "text-live", meaning: "Recalled from memory a day or more after you last saw it, and not faded since." },
  { state: "shaky", label: "Shaky", tone: "text-warn", meaning: "Checked, but missed, faded, or only right on the same day." },
  { state: "untested", label: "Untested", tone: "text-dim", meaning: "Highlighted or asked about, never checked." },
];

const WEAKEST = 3;

/**
 * What the reader knows in one book, read from the learner ledger at the moment the page is asked for: held, shaky
 * and untested counts by chapter, and the three items most worth going back to. No scores and no log.
 */
async function Knowledge({ params }: Pick<PageProps<"/book/[bookId]/knowledge">, "params">) {
  await connection();
  const { bookId } = await params;
  const found = await findBook(bookId).catch(() => null);
  if (!found) notFound();
  const { book } = found;
  const [state, log] = await Promise.all([readBookState(book.id).catch(() => null), readLedger()]);
  const items = ledgerItems(log.filter((event) => event.bookId === book.id), new Date());
  const chapters = chapterCounts(items);
  const sum = totals(chapters);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-display text-paper">What you know</h1>
        <p className="font-reading text-callout italic leading-relaxed text-fog">{state?.meta?.title || book.fileTitle}</p>
        {items.length ? (
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-callout font-medium tabular-nums text-paper">
            {STATES.map(({ state: name, label, tone, meaning }) => (
              <span key={name} title={meaning}>
                <span className={tone}>{sum[name]}</span> {label.toLowerCase()}
              </span>
            ))}
          </p>
        ) : null}
        <div className="mt-1">
          <Link href={`/book/${book.id}`} className="press inline-flex h-7 items-center gap-1.5 rounded-sm bg-panel-raised px-2.5 text-label font-medium text-paper shadow-chip hover:bg-panel-hover">
            Open the book
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </div>
      </div>

      {items.length ? (
        <>
          <Weakest bookId={book.id} items={weakest(items, WEAKEST)} />
          <section className="flex flex-col gap-2">
            <h2 className="text-body font-semibold uppercase tracking-wide text-dim">Chapters</h2>
            <div className="rounded-xl bg-panel px-4 py-2 shadow-canvas">
              <table className="w-full text-left text-body">
                <thead>
                  <tr className="text-label text-dim">
                    <th scope="col" className="py-1.5 font-medium">
                      Chapter
                    </th>
                    {STATES.map(({ state: name, label, meaning }) => (
                      <th key={name} scope="col" title={meaning} className="w-20 py-1.5 text-right font-medium">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chapters.map((chapter) => (
                    <ChapterRow key={chapter.chapter ?? ""} chapter={chapter} />
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="flex flex-col gap-0.5 text-label leading-snug text-dim">
              {STATES.map(({ state: name, label, meaning }) => (
                <li key={name}>
                  <span className="font-medium text-fog">{label}:</span> {meaning}
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : (
        <EmptyState icon={<Sprout />} title="Nothing recorded for this book yet" body="Highlight a passage, review a card or take a chapter quiz, and it shows here." />
      )}
    </div>
  );
}

function ChapterRow({ chapter }: { chapter: ChapterCounts }) {
  return (
    <tr className="border-t border-line">
      <th scope="row" className="py-1.5 pr-3 font-normal text-prose [overflow-wrap:anywhere]">
        {chapter.chapter ?? UNTITLED_SECTION}
      </th>
      {STATES.map(({ state: name, tone }) => (
        <td key={name} className={`py-1.5 text-right tabular-nums ${chapter[name] ? tone : "text-line-strong"}`}>
          {chapter[name]}
        </td>
      ))}
    </tr>
  );
}

/** The items most worth going back to, each with why and a way to its passage. */
function Weakest({ bookId, items }: { bookId: BookId; items: LedgerItem[] }) {
  if (!items.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-body font-semibold uppercase tracking-wide text-dim">Go back to</h2>
      <ol className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.item} className="flex flex-col gap-1 rounded-xl bg-panel px-4 py-3 shadow-canvas">
            <p className="text-callout leading-snug text-paper [overflow-wrap:anywhere]">{item.topic}</p>
            <p className="flex flex-wrap items-baseline gap-x-2 text-label text-dim">
              <span className={item.state === "shaky" ? "text-warn" : undefined}>{item.why}</span>
              {item.chapter || item.anchor ? <span>· {item.anchor ? placeLabel(item.chapter, item.anchor) : item.chapter}</span> : null}
              <Link href={item.anchor ? bookHref(bookId, item.anchor) : `/book/${bookId}`} className="press ml-auto shrink-0 font-medium text-paper underline-offset-2 hover:underline">
                {item.anchor ? "Open the passage" : "Open the book"}
              </Link>
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
