import { strToU8, zipSync } from "fflate";

/** A small EPUB 3: one section per entry, each a title and its paragraphs, and a nav listing the titles. */
export const makeEpub = (sections: { title: string; paragraphs: string[] }[]): Uint8Array => {
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
    "content.opf": strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Fixture</dc:title><dc:identifier id="id">x</dc:identifier></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${sections.map((_, i) => `<item id="s${i}" href="s${i}.xhtml" media-type="application/xhtml+xml"/>`).join("\n")}</manifest>
<spine>${sections.map((_, i) => `<itemref idref="s${i}"/>`).join("")}</spine></package>`),
    "nav.xhtml": strToU8(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Nav</title></head>
<body><nav epub:type="toc"><ol>${sections.map((s, i) => `<li><a href="s${i}.xhtml">${escape(s.title)}</a></li>`).join("")}</ol></nav></body></html>`),
  };
  sections.forEach((section, i) => {
    files[`s${i}.xhtml`] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escape(section.title)}</title></head>
<body><h1>${escape(section.title)}</h1>
${section.paragraphs.map((p) => `<p>${escape(p)}</p>`).join("\n")}
</body></html>`);
  });
  return zipSync(files);
};

/** A PDF with one page per entry, each line of text set in Helvetica down the page. */
export const makePdf = (pages: string[][]): Uint8Array => {
  const escape = (text: string) => text.replace(/[\\()]/g, "\\$&");
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((lines, i) => {
    const stream = `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((line) => `(${escape(line)}) Tj T*`).join(" ")} ET`;
    objects[pageIds[i]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`;
    objects[pageIds[i] + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(body);
};
