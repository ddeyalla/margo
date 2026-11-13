import type { ImageMediaType } from "./types";

export const IMAGE_TYPES: readonly ImageMediaType[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export const MAX_IMAGES_PER_MESSAGE = 4;

/** The largest image the server keeps, after the browser has resized it. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const attachmentUrl = (bookId: string, id: string) => `/api/books/${bookId}/attachments/${id}`;
