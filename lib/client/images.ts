import { IMAGE_TYPES } from "@/lib/shared/attachments";
import type { BookId, ImageAttachment, ImageMediaType } from "@/lib/shared/types";

/** Files larger than this are refused before any work. */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
/** The longest side worth sending; the tutors shrink anything larger anyway. */
const MAX_SIDE = 1568;
/** A PNG or GIF up to this size keeps its own format. Base64 then stays under the API's 5 MB per image. */
const KEEP_BYTES = 3.5 * 1024 * 1024;
const QUALITY = 0.9;

const isImageType = (type: string): type is ImageMediaType => (IMAGE_TYPES as string[]).includes(type);

const encode = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Makes an image ready to upload, with its longest side at most 1568 px. A
 * PNG or GIF that already fits and is small goes up as it is. Anything else is
 * redrawn, which also turns phone photos upright and drops their metadata. A
 * PNG or GIF stays PNG while that stays small, because text in screenshots
 * must stay sharp. The rest becomes WebP, or JPEG where the browser can't
 * write WebP.
 */
export const prepareImage = async (file: File): Promise<Blob> => {
  if (file.size > MAX_SOURCE_BYTES) throw new Error("This image is over 20 MB.");
  if (!isImageType(file.type)) throw new Error("Only PNG, JPEG, WebP and GIF images can be attached.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("This image could not be read.");
  });
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const lossless = file.type === "image/png" || file.type === "image/gif";
    if (scale === 1 && lossless && file.size <= KEEP_BYTES) return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This image could not be resized.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    if (lossless) {
      const png = await encode(canvas, "image/png");
      if (png && png.size <= KEEP_BYTES) return png;
    }
    const webp = await encode(canvas, "image/webp", QUALITY);
    if (webp?.type === "image/webp") return webp;
    /* JPEG has no transparency; put what was clear on white rather than black. */
    context.globalCompositeOperation = "destination-over";
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const jpeg = await encode(canvas, "image/jpeg", QUALITY);
    if (!jpeg) throw new Error("This image could not be resized.");
    return jpeg;
  } finally {
    bitmap.close();
  }
};

/** Uploads a prepared image for this book. The server checks it and answers with its id and size. */
export const uploadImage = async (bookId: BookId, image: Blob): Promise<ImageAttachment> => {
  const response = await fetch(`/api/books/${bookId}/attachments`, { method: "POST", body: image });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : null;
    throw new Error(message ?? `The image could not be uploaded (${response.status}).`);
  }
  return body as ImageAttachment;
};
