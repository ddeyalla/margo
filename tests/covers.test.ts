import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { bookCover, epubCover } from "@/lib/server/covers";
import type { FoundBook } from "@/lib/server/library";
import type { BookId } from "@/lib/shared/types";

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const opf = (manifest: string, metadata = "") => `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata>${metadata}</metadata>
  <manifest>${manifest}</manifest>
</package>`;

/** An EPUB with the given package file and other files, as zip bytes. */
const epub = (packageXml: string, files: Record<string, string> = {}) =>
  zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(CONTAINER),
    "OEBPS/content.opf": strToU8(packageXml),
    ...Object.fromEntries(Object.entries(files).map(([name, body]) => [name, strToU8(body)])),
  });

const decode = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : null);

describe("epubCover", () => {
  it("finds the item marked cover-image, relative to the package file", () => {
    const zip = epub(
      opf(`<item id="a" href="images/inside.png" media-type="image/png"/>
           <item id="b" href="images/my%20front.jpg" media-type="image/jpeg" properties="cover-image"/>`),
      { "OEBPS/images/inside.png": "inside", "OEBPS/images/my front.jpg": "front" },
    );
    expect(decode(epubCover(zip))).toBe("front");
  });

  it("falls back to the image the cover meta names", () => {
    const zip = epub(
      opf(`<opf:item href="../art/one&amp;two.jpg" id="art" media-type="image/jpeg"/>
           <opf:item id="other" href="other.png" media-type="image/png"/>`, `<meta content="art" name="cover"/>`),
      { "art/one&two.jpg": "meta cover", "OEBPS/other.png": "other" },
    );
    expect(decode(epubCover(zip))).toBe("meta cover");
  });

  it("falls back to an image called cover when nothing marks one", () => {
    const zip = epub(
      opf(`<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>
           <item id="i1" href="figure.png" media-type="image/png"/>
           <item id="i2" href="Cover.JPG" media-type="image/jpeg"/>`, `<meta name="cover" content="cover-page"/>`),
      { "OEBPS/cover.xhtml": "<html/>", "OEBPS/figure.png": "figure", "OEBPS/Cover.JPG": "named cover" },
    );
    expect(decode(epubCover(zip))).toBe("named cover");
  });

  it("is null for a book with no cover image or no package file", () => {
    expect(epubCover(epub(opf(`<item id="i1" href="figure.png" media-type="image/png"/>`), { "OEBPS/figure.png": "figure" }))).toBeNull();
    expect(epubCover(zipSync({ mimetype: strToU8("application/epub+zip") }))).toBeNull();
  });
});

describe("bookCover", () => {
  const png = () => new Uint8Array(createCanvas(30, 45).encodeSync("png"));

  it("makes a JPEG once, keeps it while the book is unchanged, and remakes it when the book changes", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "margo-covers-"));
    const absPath = path.join(base, "book.epub");
    const zip = zipSync({
      "META-INF/container.xml": strToU8(CONTAINER),
      "OEBPS/content.opf": strToU8(opf(`<item id="c" href="c.png" media-type="image/png" properties="cover-image"/>`)),
      "OEBPS/c.png": png(),
    });
    await writeFile(absPath, zip);
    const found = (modifiedAt: string): FoundBook => ({
      absPath,
      book: { id: "a".repeat(40) as BookId, format: "epub", relPath: "book.epub", folder: "", fileTitle: "Book", fileAuthor: null, sizeBytes: zip.length, modifiedAt },
    });
    const dir = path.join(base, "covers");

    const first = await bookCover(found("2026-01-01T00:00:00.123Z"), dir);
    expect([...(first ?? new Uint8Array()).subarray(0, 2)]).toEqual([0xff, 0xd8]);

    /* Kept: the book file isn't read again. */
    await rm(absPath);
    expect(await bookCover(found("2026-01-01T00:00:00.123Z"), dir)).toEqual(first);

    /* Changed: made again, and with the file gone there is no cover. */
    expect(await bookCover(found("2026-02-01T00:00:00.000Z"), dir)).toBeNull();
  });
});
