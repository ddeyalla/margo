import type { ImageMediaType } from "./types";

export const IMAGE_EXTENSIONS: Record<ImageMediaType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const IMAGE_TYPES = Object.keys(IMAGE_EXTENSIONS) as ImageMediaType[];

export const MAX_IMAGES_PER_MESSAGE = 4;

/** The largest image the server keeps, after the browser has resized it. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const attachmentUrl = (bookId: string, id: string) => `/api/books/${bookId}/attachments/${id}`;
