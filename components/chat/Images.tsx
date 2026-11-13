"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Image from "next/image";
import clsx from "clsx";
import { CircleAlert, X } from "lucide-react";
import { Spinner } from "@/components/ui";
import { attachmentUrl } from "@/lib/shared/attachments";
import type { BookId, ImageAttachment } from "@/lib/shared/types";
import { useFileDrop, type DraftImage } from "./useImageDraft";

/** The images waiting in the composer, each with a way to take it out again. */
export function DraftImages({ images, onRemove }: { images: DraftImage[]; onRemove(key: string): void }) {
  return (
    <ul aria-label="Attached images" className="flex flex-wrap gap-2 px-3 pt-3">
      {images.map((image, index) => {
        const { state } = image;
        return (
          <li
            key={image.key}
            title={state.status === "failed" ? state.error : undefined}
            className="relative size-14 shrink-0 overflow-hidden rounded-md bg-panel-hover ring-1 ring-inset ring-white/[0.06]"
          >
            <Image src={image.preview} alt={`Image ${index + 1}`} fill unoptimized className="object-cover" />
            {state.status === "uploading" ? (
              <span role="status" aria-label="Attaching image" className="absolute inset-0 grid place-items-center bg-ink/60 text-paper">
                <Spinner />
              </span>
            ) : state.status === "failed" ? (
              <span className="absolute inset-0 grid place-items-center bg-danger/40 text-paper">
                <CircleAlert className="size-4" aria-label={state.error} />
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => onRemove(image.key)}
              aria-label={`Remove image ${index + 1}`}
              title="Remove"
              className="press absolute right-0.5 top-0.5 grid size-[18px] place-items-center rounded-full bg-ink/80 text-fog transition-colors duration-[var(--duration-fast)] hover:bg-ink hover:text-paper focus-visible:outline-2 focus-visible:outline-accent"
            >
              <X className="size-3" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** A user message's images, right-aligned above its words. Each opens larger. */
export function MessageImages({
  bookId,
  images,
  onOpen,
}: {
  bookId: BookId;
  images: ImageAttachment[];
  onOpen(image: ImageAttachment): void;
}) {
  return (
    <div className="flex max-w-full flex-wrap justify-end gap-1.5">
      {images.map((image, index) => (
        <button
          key={image.id}
          type="button"
          onClick={() => onOpen(image)}
          title="View larger"
          className="press overflow-hidden rounded-[10px] bg-panel-hover ring-1 ring-inset ring-white/[0.06] focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Image
            src={attachmentUrl(bookId, image.id)}
            alt={`Image ${index + 1} you sent`}
            width={image.width}
            height={image.height}
            unoptimized
            className="h-28 w-auto max-w-[220px] object-cover"
          />
        </button>
      ))}
    </div>
  );
}

/** An image at full size over everything. Esc, the close button or a click outside the image closes it. */
export function Lightbox({ bookId, image, onClose }: { bookId: BookId; image: ImageAttachment; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);

  /* No close() on cleanup: its close event would call onClose after a remount. Unmounting takes the dialog off the top layer anyway. */
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label="Image"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-auto max-h-none max-w-none overflow-visible bg-transparent p-0 outline-none backdrop:bg-black/80"
    >
      <Image
        src={attachmentUrl(bookId, image.id)}
        alt="The image at full size"
        width={image.width}
        height={image.height}
        unoptimized
        className="h-auto max-h-[90dvh] w-auto max-w-[90vw] rounded-lg object-contain shadow-float"
      />
      <button
        type="button"
        autoFocus
        onClick={onClose}
        aria-label="Close"
        title="Close (Esc)"
        className="press fixed right-4 top-4 grid size-8 place-items-center rounded-full bg-panel-raised text-fog shadow-float transition-colors duration-[var(--duration-fast)] hover:bg-panel-hover hover:text-paper focus-visible:outline-2 focus-visible:outline-accent"
      >
        <X className="size-4" aria-hidden />
      </button>
    </dialog>
  );
}

/** An area of the panel that takes dropped images for the composer, and says so while files hover over it. */
export function DropArea({
  onFiles,
  enabled,
  className,
  children,
}: {
  onFiles(files: File[]): void;
  enabled: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { over, handlers } = useFileDrop(onFiles, enabled);
  return (
    <div {...handlers} className={clsx("relative", className)}>
      {children}
      {over ? (
        <div className="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-xl bg-panel/85 text-label text-paper ring-1 ring-inset ring-white/[0.18]">
          Drop images to attach
        </div>
      ) : null}
    </div>
  );
}
