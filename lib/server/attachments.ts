import { randomBytes } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { IMAGE_EXTENSIONS, IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/shared/attachments";
import type { BookId, ChatMessage, ImageAttachment, ImageMediaType } from "@/lib/shared/types";
import { getConfig } from "./config";
import { writeFileAtomic } from "./store";
import { isBookId } from "./library-index";
import { isAttachmentId } from "./validate";

export const TOO_LARGE = "This image is over 5 MB, even after resizing.";

/** The longest side the tutors accept. */
const MAX_SIDE = 8000;

type ImageInfo = Omit<ImageAttachment, "id">;

const hasAscii = (bytes: Uint8Array, at: number, text: string) =>
  [...text].every((char, index) => bytes[at + index] === char.charCodeAt(0));

/** A JPEG's size sits in its first start-of-frame segment, after any metadata segments. */
const jpegSize = (bytes: Uint8Array, view: DataView) => {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at += 1;
    } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
    } else {
      at += 2 + view.getUint16(at + 2);
    }
  }
  return null;
};

/** WebP comes in three layouts: lossy, lossless and extended. */
const webpSize = (bytes: Uint8Array, view: DataView) => {
  if (hasAscii(bytes, 12, "VP8 ") && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (hasAscii(bytes, 12, "VP8L") && bytes[20] === 0x2f) {
    return {
      width: 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8)),
      height: 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10)),
    };
  }
  if (hasAscii(bytes, 12, "VP8X")) {
    return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
  }
  return null;
};

/**
 * What an image's first bytes say it is, and its size in pixels. The browser's
 * MIME type and file name are never trusted. Null for anything else.
 */
export const sniffImage = (bytes: Uint8Array): ImageInfo | null => {
  /* Every format's size fields sit in the first 30 bytes. */
  if (bytes.length < 30) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let info: ImageInfo | null = null;
  if (bytes[0] === 0x89 && hasAscii(bytes, 1, "PNG\r\n\x1a\n") && hasAscii(bytes, 12, "IHDR")) {
    info = { mediaType: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const size = jpegSize(bytes, view);
    info = size && { mediaType: "image/jpeg", ...size };
  } else if (hasAscii(bytes, 0, "GIF87a") || hasAscii(bytes, 0, "GIF89a")) {
    info = { mediaType: "image/gif", width: view.getUint16(6, true), height: view.getUint16(8, true) };
  } else if (hasAscii(bytes, 0, "RIFF") && hasAscii(bytes, 8, "WEBP")) {
    const size = webpSize(bytes, view);
    info = size && { mediaType: "image/webp", ...size };
  }
  if (!info || info.width < 1 || info.height < 1 || info.width > MAX_SIDE || info.height > MAX_SIDE) return null;
  return info;
};

const imageFile = (bookId: BookId, id: string, mediaType: ImageMediaType, dataDir: string) =>
  path.join(/*turbopackIgnore: true*/ dataDir, "attachments", bookId, `${id}.${IMAGE_EXTENSIONS[mediaType]}`);

/** Keeps an uploaded image under a new id, or says why it can't. */
export const saveAttachment = async (
  bookId: BookId,
  bytes: Uint8Array,
  dataDir = getConfig().dataDir,
): Promise<ImageAttachment | string> => {
  if (bytes.length > MAX_IMAGE_BYTES) return TOO_LARGE;
  const info = sniffImage(bytes);
  if (!info) return "Only PNG, JPEG, WebP and GIF images can be attached.";
  const attachment: ImageAttachment = { id: randomBytes(16).toString("hex"), ...info };
  await writeFileAtomic(imageFile(bookId, attachment.id, info.mediaType, dataDir), bytes);
  return attachment;
};

/** A stored image and its bytes, or null if the id is malformed or this book has no such image. */
export const readAttachment = async (
  bookId: BookId,
  id: string,
  dataDir = getConfig().dataDir,
): Promise<{ attachment: ImageAttachment; bytes: Buffer } | null> => {
  if (!isAttachmentId(id)) return null;
  for (const mediaType of IMAGE_TYPES) {
    let bytes: Buffer;
    try {
      bytes = await readFile(imageFile(bookId, id, mediaType, dataDir));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const info = sniffImage(bytes);
    return info ? { attachment: { id, ...info }, bytes } : null;
  }
  return null;
};

/** The bytes of every image in these messages, by id. An image whose file is gone is left out. */
export const readMessageImages = async (
  bookId: BookId,
  messages: ChatMessage[],
  dataDir = getConfig().dataDir,
): Promise<Map<string, Buffer>> => {
  const ids = new Set(messages.flatMap((message) => message.attachments ?? []).map((attachment) => attachment.id));
  const found = await Promise.all([...ids].map((id) => readAttachment(bookId, id, dataDir)));
  return new Map(found.flatMap((image) => (image ? [[image.attachment.id, image.bytes] as const] : [])));
};

/** Deletes every image kept for the book. The id is checked here as well, because it names a folder removed with everything in it. */
export const deleteAttachments = async (bookId: BookId, dataDir = getConfig().dataDir): Promise<void> => {
  if (!isBookId(bookId)) throw new Error(`Not a book id: ${JSON.stringify(bookId)}`);
  await rm(path.join(/*turbopackIgnore: true*/ dataDir, "attachments", bookId), { recursive: true, force: true });
};
