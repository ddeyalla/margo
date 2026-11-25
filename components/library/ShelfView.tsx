"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { CoverImage } from "./CoverImage";
import { FINISHED, formatSize, toneOf, type Shelf, type ShelfBook } from "./BookList";

type Rgb = [number, number, number];

/* Every book the same size, so covers line up and the row reads at a glance. */
const HEIGHT = 264;
const WIDTH = 176;
/* No page counts here, so the file's size stands in for how thick the book is. Only seen as the book turns. */
const thicknessOf = (book: ShelfBook) => Math.round(Math.min(40, Math.max(18, 16 + Math.log2(book.sizeBytes / (1024 * 1024) + 1) * 4)));

/** Where the book is, in words: its progress, or its format and size when it was never opened. */
const placeOf = (book: ShelfBook) =>
  book.progress === null
    ? `${book.format === "epub" ? "EPUB" : "PDF"} · ${formatSize(book.sizeBytes)}`
    : book.progress >= FINISHED
      ? "Finished"
      : `${Math.round(book.progress * 100)}% read`;

/* The spine takes its colour from the cover's left edge, the part that wraps around a real book. Covers are
   same-origin, so the canvas can read them. One sample per cover for the life of the page. */
const colours = new Map<string, Promise<Rgb | null>>();

const sampleColour = (src: string): Promise<Rgb | null> => {
  const known = colours.get(src);
  if (known) return known;
  const sampled = new Promise<Rgb | null>((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 24;
        canvas.height = 36;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, 24, 36);
        const { data } = context.getImageData(0, 0, 6, 36);
        let red = 0;
        let green = 0;
        let blue = 0;
        for (let index = 0; index < data.length; index += 4) {
          red += data[index];
          green += data[index + 1];
          blue += data[index + 2];
        }
        const pixels = data.length / 4;
        resolve([Math.round(red / pixels), Math.round(green / pixels), Math.round(blue / pixels)]);
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = src;
  });
  colours.set(src, sampled);
  return sampled;
};

function useSpineColour(src: string): Rgb | null {
  const [colour, setColour] = useState<Rgb | null>(null);
  useEffect(() => {
    let live = true;
    void sampleColour(src).then((value) => {
      if (live) setColour(value);
    });
    return () => {
      live = false;
    };
  }, [src]);
  return colour;
}

/** Dark ink on a light spine, light ink on a dark one. */
const inkFor = ([red, green, blue]: Rgb) => ((0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255 > 0.6 ? "#1b1b1b" : "#f4f1ea");

const PAGES = "repeating-linear-gradient(90deg, #ece6d8 0 1px, #d9d2c2 1px 2px)";
const PAGES_TOP = "repeating-linear-gradient(0deg, #ece6d8 0 1px, #d9d2c2 1px 2px)";
/* Light catching the rounded spine: darker at both hinges, a soft highlight just off centre. */
const SPINE_SHADE =
  "linear-gradient(90deg, rgba(0,0,0,0.32), rgba(0,0,0,0.05) 18%, rgba(255,255,255,0.1) 38%, rgba(0,0,0,0.04) 70%, rgba(0,0,0,0.34))";
/* The groove where the front board bends at the hinge. */
const HINGE_SHADE = "linear-gradient(90deg, rgba(0,0,0,0.28), rgba(0,0,0,0) 3%, rgba(255,255,255,0.12) 4.5%, rgba(0,0,0,0) 8%)";

function Spine({ book, colour }: { book: ShelfBook; colour: Rgb | null }) {
  const background = colour ? `rgb(${colour.join(" ")})` : toneOf(book.id);
  const ink = colour ? inkFor(colour) : "#f4f1ea";
  return (
    <div className="relative flex h-full flex-col items-center gap-2 overflow-hidden py-3" style={{ background, color: ink }}>
      <span aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: SPINE_SHADE }} />
      {book.author ? (
        <span className="relative max-h-[30%] overflow-hidden text-ellipsis whitespace-nowrap text-[9.5px] font-medium uppercase tracking-[0.14em] opacity-70 [writing-mode:vertical-rl]">
          {book.author}
        </span>
      ) : null}
      <span className="relative line-clamp-2 min-h-0 flex-1 font-reading text-label leading-[1.12] [writing-mode:vertical-rl]">{book.title}</span>
    </div>
  );
}

/**
 * One book, cover out. It is a box in 3D, so when the pointer comes over it the book lifts and turns a little
 * toward it, showing its spine and pages, then settles back flat. A click opens it.
 */
function Book({ book, onShow, onStep }: { book: ShelfBook; onShow: (id: string) => void; onStep: (from: HTMLElement, by: number) => void }) {
  const colour = useSpineColour(book.cover);
  const boxRef = useRef<HTMLDivElement>(null);
  const depth = thicknessOf(book);
  const back = colour ? `rgb(${colour.map((value) => Math.round(value * 0.7)).join(" ")})` : toneOf(book.id);
  const progress = book.progress === null ? null : Math.min(1, book.progress);

  const onKeyDown = (event: KeyboardEvent<HTMLAnchorElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    onStep(event.currentTarget, event.key === "ArrowRight" ? 1 : -1);
  };

  /* Turn toward the pointer. Written to the box's own transform, not a variable its faces inherit, so a pointer
     move restyles one element and never re-renders. */
  const lean = (x: number, y: number) => {
    if (boxRef.current) boxRef.current.style.transform = `translateY(-6px) rotateY(${10 + x * 16}deg) rotateX(${-y * 8}deg)`;
  };
  const onPointerMove = (event: PointerEvent<HTMLAnchorElement>) => {
    if (event.pointerType !== "mouse") return;
    const box = event.currentTarget.getBoundingClientRect();
    lean((event.clientX - box.left) / box.width - 0.5, (event.clientY - box.top) / box.height - 0.5);
  };
  const settle = () => {
    if (boxRef.current) boxRef.current.style.transform = "";
  };

  const face = "absolute [backface-visibility:hidden]";
  return (
    <li data-book={book.id} className="flex shrink-0 flex-col gap-3" style={{ width: WIDTH }}>
      <Link
        href={`/book/${book.id}`}
        aria-label={`${book.title}${book.author ? `, ${book.author}` : ""}, ${placeOf(book)}`}
        onPointerEnter={() => onShow(book.id)}
        onFocus={(event) => {
          onShow(book.id);
          if (event.currentTarget.matches(":focus-visible")) lean(0, 0);
        }}
        onBlur={settle}
        onKeyDown={onKeyDown}
        onPointerMove={onPointerMove}
        onPointerLeave={settle}
        className="group/book press relative block rounded-[3px] outline-none [perspective:1000px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        style={{ height: HEIGHT }}
      >
        <div
          ref={boxRef}
          className="absolute inset-0 [transform-style:preserve-3d] transition-transform duration-[var(--duration-settle)] ease-[var(--ease-out)] motion-reduce:transition-none"
        >
          {/* Front cover */}
          <div className={`${face} inset-0 overflow-hidden rounded-r-[3px]`} style={{ transform: `translateZ(${depth / 2}px)`, backgroundColor: toneOf(book.id) }}>
            <div aria-hidden className="absolute inset-0 flex flex-col p-4">
              <span className="h-px w-7 bg-white/25" />
              <p className="mt-3 line-clamp-6 font-reading text-[17px] leading-[1.2] text-white/90">{book.title}</p>
              {book.author ? <p className="mt-auto line-clamp-2 text-caption leading-snug text-white/60">{book.author}</p> : null}
            </div>
            <CoverImage src={book.cover} />
            <span aria-hidden className="absolute inset-0" style={{ backgroundImage: HINGE_SHADE }} />
          </div>
          {/* Back cover */}
          <div className={`${face} inset-0 rounded-l-[3px]`} style={{ transform: `rotateY(180deg) translateZ(${depth / 2}px)`, background: back }} />
          {/* Spine, on the left */}
          <div className={`${face} top-0`} style={{ width: depth, height: HEIGHT, left: (WIDTH - depth) / 2, transform: `rotateY(-90deg) translateZ(${WIDTH / 2}px)` }}>
            <Spine book={book} colour={colour} />
          </div>
          {/* Page edges, set in a touch from the boards */}
          <div
            className={`${face} top-[3px]`}
            style={{ width: depth - 4, height: HEIGHT - 6, left: (WIDTH - depth + 4) / 2, transform: `rotateY(90deg) translateZ(${WIDTH / 2 - 3}px)`, background: PAGES }}
          />
          <div
            className={face}
            style={{ width: WIDTH - 4, height: depth - 4, top: (HEIGHT - depth + 4) / 2, left: 0, transform: `rotateX(90deg) translateZ(${HEIGHT / 2 - 3}px)`, background: PAGES_TOP }}
          />
        </div>
        {/* The book's shadow, which spreads as it lifts */}
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-1.5 left-1/2 -z-10 h-3 w-[86%] -translate-x-1/2 rounded-[50%] bg-black/40 blur-md transition-[opacity,scale] duration-[var(--duration-settle)] ease-[var(--ease-out)] group-hover/book:scale-x-105 group-hover/book:opacity-70"
        />
      </Link>
      {progress !== null ? (
        <span aria-hidden className="h-[2px] overflow-hidden rounded-full bg-tint-strong">
          <span className="block h-full rounded-full bg-paper/70" style={{ width: `${Math.max(2, progress * 100)}%` }} />
        </span>
      ) : (
        <span aria-hidden className="h-[2px]" />
      )}
    </li>
  );
}

/** One folder's books in a row, covers out. The book under the pointer or keyboard is named below the row. */
function BookShelf({ label, count, books }: { label: string; count?: number; books: ShelfBook[] }) {
  const [shownId, setShownId] = useState<string | null>(books[0]?.id ?? null);
  const listRef = useRef<HTMLUListElement>(null);
  const shown = books.find((book) => book.id === shownId) ?? books[0];

  const step = (from: HTMLElement, by: number) => {
    const links = [...(listRef.current?.querySelectorAll<HTMLAnchorElement>("li > a") ?? [])];
    links[links.indexOf(from as HTMLAnchorElement) + by]?.focus();
  };

  return (
    <section aria-label={label} className="flex flex-col gap-1">
      <h2 className="font-mono text-caption uppercase tracking-[0.08em] text-dim">
        [ {label}
        {count !== undefined ? <span className="tabular-nums"> · {count}</span> : null} ]
      </h2>
      <ul
        ref={listRef}
        className="-mx-2 flex items-end gap-6 overflow-x-auto px-6 pb-4 pt-6 [scrollbar-width:thin] [mask-image:linear-gradient(90deg,transparent,#000_20px,#000_calc(100%-20px),transparent)]"
      >
        {books.map((book) => (
          <Book key={book.id} book={book} onShow={setShownId} onStep={step} />
        ))}
      </ul>
      {shown ? (
        <div className="flex min-h-14 items-end justify-between gap-6 border-t border-line pt-3">
          <div className="min-w-0">
            <p className="truncate font-reading text-display font-normal italic text-paper">{shown.title}</p>
            <p className="mt-1 truncate font-mono text-caption uppercase tracking-[0.08em] text-dim">
              {shown.author ? `${shown.author} · ` : ""}
              {placeOf(shown)}
            </p>
          </div>
          <Link
            href={`/book/${shown.id}`}
            tabIndex={-1}
            className="shrink-0 font-mono text-caption uppercase tracking-[0.08em] text-fog hover:text-paper"
          >
            {shown.progress === null ? "Start reading" : "Open book"} [+]
          </Link>
        </div>
      ) : null}
    </section>
  );
}

/** The library as shelves of books: what you're reading first, then one shelf per folder. */
export function ShelfView({ shelves, recent }: { shelves: Shelf[]; recent: ShelfBook[] }) {
  return (
    <div className="flex flex-col gap-12">
      {recent.length ? <BookShelf label="Continue reading" books={recent} /> : null}
      {shelves.map((shelf) => (
        <BookShelf key={shelf.folder} label={shelf.folder || "Unsorted"} count={shelf.books.length} books={shelf.books} />
      ))}
    </div>
  );
}
