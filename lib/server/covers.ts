import { readFile, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage, type Canvas } from "@napi-rs/canvas";
import { unzipSync } from "fflate";
import { getConfig } from "./config";
import type { BookId } from "@/lib/shared/types";
import type { FoundBook } from "./library";
import { serialized, writeFileAtomic } from "./store";

/** Covers are kept this wide: sharp on a card at 2x, and small on disk. */
const COVER_WIDTH = 480;
const JPEG_QUALITY = 82;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) => {
    if (name[0] !== "#") return ENTITIES[name] ?? whole;
    return String.fromCodePoint(name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
  });

/** The attributes of every `<name …>` tag, with or without a namespace prefix. */
const tags = (xml: string, name: string): Record<string, string>[] =>
  [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${name}\\b([^>]*)>`, "g"))].map(([, body]) =>
    Object.fromEntries([...body.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(([, key, a, b]) => [key, decodeEntities(a ?? b)])),
  );

/** One file from the archive, inflating nothing else. */
const entry = (zip: Uint8Array, name: string): Uint8Array | null => unzipSync(zip, { filter: (file) => file.name === name })[name] ?? null;

const text = (zip: Uint8Array, name: string) => {
  const bytes = entry(zip, name);
  return bytes ? new TextDecoder().decode(bytes) : null;
};

/** A manifest href as a path inside the archive, relative to the package file. */
const resolveHref = (opfPath: string, href: string) => {
  const bare = href.split("#")[0];
  let decoded = bare;
  try {
    decoded = decodeURIComponent(bare);
  } catch {}
  return path.posix.normalize(path.posix.join(path.posix.dirname(opfPath), decoded));
};

/**
 * The cover image inside an EPUB, as stored: the manifest item marked
 * `cover-image` (EPUB 3), else the one `<meta name="cover">` names (EPUB 2),
 * else an image whose id or file name says cover.
 */
export const epubCover = (zip: Uint8Array): Uint8Array | null => {
  const container = text(zip, "META-INF/container.xml");
  const opfPath = container && tags(container, "rootfile")[0]?.["full-path"];
  const opf = opfPath ? text(zip, opfPath) : null;
  if (!opfPath || !opf) return null;
  const images = tags(opf, "item").filter((item) => item["media-type"]?.startsWith("image/") && item.href);
  const coverId = tags(opf, "meta").find((meta) => meta.name === "cover")?.content;
  const item =
    images.find((image) => image.properties?.split(/\s+/).includes("cover-image")) ??
    images.find((image) => coverId && image.id === coverId) ??
    images.find((image) => /cover/i.test(`${image.id ?? ""} ${image.href}`));
  return item ? entry(zip, resolveHref(opfPath, item.href)) : null;
};

const toJpeg = (canvas: Canvas) => canvas.encode("jpeg", JPEG_QUALITY);

/** Any image format the canvas reads, scaled down to the cover width, on white for images with transparency. */
const imageToJpeg = async (bytes: Uint8Array) => {
  const image = await loadImage(Buffer.from(bytes));
  const scale = Math.min(1, COVER_WIDTH / image.width);
  const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return toJpeg(canvas);
};

/** The first page of a PDF, drawn at the cover width. */
const pdfFirstPage = async (data: Uint8Array) => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const assets = path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules/pdfjs-dist");
  const task = pdfjs.getDocument({
    data,
    standardFontDataUrl: `${assets}/standard_fonts/`,
    cMapUrl: `${assets}/cmaps/`,
    wasmUrl: `${assets}/wasm/`,
  });
  try {
    const page = await (await task.promise).getPage(1);
    const viewport = page.getViewport({ scale: COVER_WIDTH / page.getViewport({ scale: 1 }).width });
    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    /* pdf.js draws with this same canvas package in Node; its types only know the DOM canvas. */
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
    return toJpeg(canvas);
  } finally {
    await task.destroy();
  }
};

const makeCover = async ({ book, absPath }: FoundBook): Promise<Buffer | null> => {
  const data = new Uint8Array(await readFile(absPath));
  if (book.format === "pdf") return pdfFirstPage(data);
  const image = epubCover(data);
  return image ? imageToJpeg(image) : null;
};

/** True when the file exists and was stamped with this book time. Rounded, as utimes stores the time as a float of seconds. */
const stampedWith = async (file: string, time: number) => {
  try {
    return Math.round((await stat(file)).mtimeMs) === time;
  } catch {
    return false;
  }
};

/**
 * A book's cover as a JPEG, or null when it has none. Made once and kept in
 * data/covers, stamped with the book file's modified time, so a changed book
 * gets a new cover. A book without one leaves a `.none` marker, so it isn't
 * tried again on every visit.
 */
export const bookCover = (found: FoundBook, dir = path.join(/*turbopackIgnore: true*/ getConfig().dataDir, "covers")): Promise<Buffer | null> => {
  const jpg = path.join(/*turbopackIgnore: true*/ dir, `${found.book.id}.jpg`);
  const none = path.join(/*turbopackIgnore: true*/ dir, `${found.book.id}.none`);
  return serialized(jpg, async () => {
    const time = Date.parse(found.book.modifiedAt);
    if (await stampedWith(jpg, time)) return readFile(jpg);
    if (await stampedWith(none, time)) return null;
    const cover = await makeCover(found).catch((error: unknown) => {
      console.warn(`No cover for ${found.book.relPath}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    const file = cover ? jpg : none;
    await rm(cover ? none : jpg, { force: true });
    await writeFileAtomic(file, cover ?? "");
    await utimes(file, new Date(), new Date(time));
    return cover;
  });
};

/** Deletes a book's cover or no-cover marker, in the queue `bookCover` uses, so the next visit draws it again. */
export const dropCover = (id: BookId, dir = path.join(/*turbopackIgnore: true*/ getConfig().dataDir, "covers")): Promise<void> => {
  const jpg = path.join(/*turbopackIgnore: true*/ dir, `${id}.jpg`);
  const none = path.join(/*turbopackIgnore: true*/ dir, `${id}.none`);
  return serialized(jpg, async () => {
    await Promise.all([rm(jpg, { force: true }), rm(none, { force: true })]);
  });
};
