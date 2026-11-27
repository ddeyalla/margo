import { readFileSync } from "node:fs";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readAttachment, readMessageImages, saveAttachment, sniffImage, TOO_LARGE } from "@/lib/server/attachments";
import { isAttachmentId } from "@/lib/server/validate";
import { MAX_IMAGE_BYTES } from "@/lib/shared/attachments";
import type { BookId } from "@/lib/shared/types";

/* Made with ImageMagick: `magick -size 3x2 xc:'#3366cc' -strip tiny.png` and the like. */
const image = (name: string) => readFileSync(path.join(__dirname, "fixtures", "images", name));

const bookId = "c".repeat(40) as BookId;
const tempData = () => mkdtemp(path.join(tmpdir(), "margo-attachments-"));

describe("image sniffing", () => {
  it.each([
    ["tiny.png", "image/png", 3, 2],
    ["tiny.jpg", "image/jpeg", 5, 4],
    ["progressive.jpg", "image/jpeg", 1200, 900],
    ["tiny.gif", "image/gif", 4, 3],
    ["lossy.webp", "image/webp", 7, 3],
    ["lossless.webp", "image/webp", 9, 5],
    ["alpha.webp", "image/webp", 11, 6],
  ])("reads %s as %s, %ix%i, from its bytes", (name, mediaType, width, height) => {
    expect(sniffImage(image(name))).toEqual({ mediaType, width, height });
  });

  it("ignores what the file claims to be and refuses anything that isn't one of the four formats", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    expect(sniffImage(svg)).toBeNull();
    expect(sniffImage(Buffer.from("%PDF-1.7\n".padEnd(64, " ")))).toBeNull();
    expect(sniffImage(Buffer.from("<html><body>PNG</body></html>".padEnd(64, " ")))).toBeNull();
  });

  it("refuses a truncated header and a JPEG with no frame", () => {
    expect(sniffImage(image("tiny.png").subarray(0, 20))).toBeNull();
    expect(sniffImage(image("tiny.jpg").subarray(0, 40))).toBeNull();
  });

  it("refuses an image with no pixels or one wider than the tutors accept", () => {
    const png = Buffer.from(image("tiny.png"));
    png.writeUInt32BE(0, 16);
    expect(sniffImage(png)).toBeNull();
    png.writeUInt32BE(9000, 16);
    expect(sniffImage(png)).toBeNull();
  });
});

describe("attachment ids", () => {
  it("accepts only 32 lowercase hex characters", () => {
    expect(isAttachmentId("0123456789abcdef0123456789abcdef")).toBe(true);
    for (const bad of [
      "0123456789ABCDEF0123456789ABCDEF",
      "0123456789abcdef0123456789abcde",
      "0123456789abcdef0123456789abcdef.png",
      "../0123456789abcdef0123456789abcd",
      "..%2f..%2fsettings",
      "",
      42,
      null,
    ]) {
      expect(isAttachmentId(bad)).toBe(false);
    }
  });
});

describe("attachment storage", () => {
  it("keeps an image under a new id with the extension its bytes call for, and reads it back", async () => {
    const dir = await tempData();
    const saved = await saveAttachment(bookId, image("tiny.jpg"), dir);
    if (typeof saved === "string") throw new Error(saved);
    expect(saved).toMatchObject({ mediaType: "image/jpeg", width: 5, height: 4 });
    expect(isAttachmentId(saved.id)).toBe(true);
    expect(await readdir(path.join(dir, "attachments", bookId))).toEqual([`${saved.id}.jpg`]);

    const read = await readAttachment(bookId, saved.id, dir);
    expect(read?.attachment).toEqual(saved);
    expect(read?.bytes.equals(image("tiny.jpg"))).toBe(true);
  });

  it("gives each upload its own id", async () => {
    const dir = await tempData();
    const first = await saveAttachment(bookId, image("tiny.png"), dir);
    const second = await saveAttachment(bookId, image("tiny.png"), dir);
    expect(typeof first !== "string" && typeof second !== "string" && first.id !== second.id).toBe(true);
  });

  it("refuses files that aren't images and images over the size cap", async () => {
    const dir = await tempData();
    expect(await saveAttachment(bookId, Buffer.from("not an image at all, just some text here"), dir)).toMatch(/Only PNG, JPEG, WebP and GIF/);
    expect(await saveAttachment(bookId, Buffer.alloc(MAX_IMAGE_BYTES + 1), dir)).toBe(TOO_LARGE);
  });

  it("finds nothing for a malformed id, another book's image or an id never saved", async () => {
    const dir = await tempData();
    const saved = await saveAttachment(bookId, image("tiny.gif"), dir);
    if (typeof saved === "string") throw new Error(saved);
    expect(await readAttachment(bookId, `../${bookId}/${saved.id}`, dir)).toBeNull();
    expect(await readAttachment("d".repeat(40) as BookId, saved.id, dir)).toBeNull();
    expect(await readAttachment(bookId, "f".repeat(32), dir)).toBeNull();
  });

  it("reads the images a conversation refers to and leaves out ones that are gone", async () => {
    const dir = await tempData();
    const saved = await saveAttachment(bookId, image("lossy.webp"), dir);
    if (typeof saved === "string") throw new Error(saved);
    const gone = { ...saved, id: "e".repeat(32) };
    const images = await readMessageImages(
      bookId,
      [
        { role: "user", content: "What is this?", createdAt: "", attachments: [saved, gone] },
        { role: "assistant", content: "A green square.", createdAt: "" },
      ],
      dir,
    );
    expect([...images.keys()]).toEqual([saved.id]);
  });
});
