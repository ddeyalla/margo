"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { prepareImage, uploadImage } from "@/lib/client/images";
import { MAX_IMAGES_PER_MESSAGE } from "@/lib/shared/attachments";
import type { BookId, ImageAttachment } from "@/lib/shared/types";

/** An image waiting in the composer. */
export interface DraftImage {
  key: string;
  /** A local copy of the file, shown until the message is sent. */
  preview: string;
  state: { status: "uploading" } | { status: "ready"; attachment: ImageAttachment } | { status: "failed"; error: string };
}

/** The images attached to the message being written. Each one is resized and uploaded as soon as it is added. */
export function useImageDraft(bookId: BookId) {
  const [images, setImages] = useState<DraftImage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  /* Mirrors `images` so two adds in one tick still count each other, and so unmount can free the previews. */
  const current = useRef<DraftImage[]>([]);

  const update = (change: (images: DraftImage[]) => DraftImage[]) => {
    current.current = change(current.current);
    setImages(current.current);
  };

  useEffect(() => () => current.current.forEach((image) => URL.revokeObjectURL(image.preview)), []);

  const add = (files: File[]) => {
    const offered = files.filter((file) => file.type.startsWith("image/"));
    const room = MAX_IMAGES_PER_MESSAGE - current.current.length;
    const taken = offered.slice(0, Math.max(0, room));
    setNotice(
      offered.length > taken.length
        ? `Up to ${MAX_IMAGES_PER_MESSAGE} images per message.`
        : offered.length < files.length
          ? "Only images can be attached."
          : null,
    );
    for (const file of taken) {
      const key = crypto.randomUUID();
      update((list) => [...list, { key, preview: URL.createObjectURL(file), state: { status: "uploading" } }]);
      const settle = (state: DraftImage["state"]) => update((list) => list.map((image) => (image.key === key ? { ...image, state } : image)));
      prepareImage(file)
        .then((prepared) => uploadImage(bookId, prepared))
        .then(
          (attachment) => settle({ status: "ready", attachment }),
          (error: unknown) => settle({ status: "failed", error: error instanceof Error ? error.message : "This image could not be attached." }),
        );
    }
  };

  const remove = (key: string) => {
    const removed = current.current.find((image) => image.key === key);
    if (removed) URL.revokeObjectURL(removed.preview);
    update((list) => list.filter((image) => image.key !== key));
    setNotice(null);
  };

  const clear = () => {
    current.current.forEach((image) => URL.revokeObjectURL(image.preview));
    update(() => []);
    setNotice(null);
  };

  return {
    images,
    ready: images.flatMap((image) => (image.state.status === "ready" ? [image.state.attachment] : [])),
    uploading: images.some((image) => image.state.status === "uploading"),
    failed: images.some((image) => image.state.status === "failed"),
    /** Why the last add took fewer files than offered, or null. */
    notice,
    add,
    remove,
    clear,
  };
}

export type ImageDraft = ReturnType<typeof useImageDraft>;

const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");

/** Lets files be dropped anywhere on an element. `over` is true while files are dragged over it. */
export function useFileDrop(onFiles: (files: File[]) => void, enabled: boolean) {
  const [over, setOver] = useState(false);
  /* dragenter and dragleave fire for every child crossed; count them so the highlight doesn't flicker. */
  const depth = useRef(0);

  const accepts = (event: DragEvent) => {
    if (!enabled || !carriesFiles(event)) return false;
    event.preventDefault();
    return true;
  };

  return {
    over,
    handlers: {
      onDragEnter(event: DragEvent) {
        if (!accepts(event)) return;
        depth.current += 1;
        setOver(true);
      },
      onDragOver(event: DragEvent) {
        if (accepts(event)) event.dataTransfer.dropEffect = "copy";
      },
      onDragLeave(event: DragEvent) {
        if (!accepts(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      },
      onDrop(event: DragEvent) {
        if (!accepts(event)) return;
        depth.current = 0;
        setOver(false);
        onFiles([...event.dataTransfer.files]);
      },
    },
  };
}
