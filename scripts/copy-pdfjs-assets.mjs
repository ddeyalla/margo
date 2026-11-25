// Copies runtime assets the browser loads by URL into public/: pdf.js's, and the fonts Excalidraw draws text with
// (it fetches them from a CDN otherwise, and the app stays offline). They come from the installed packages, so they
// always match their versions.
import { cpSync, rmSync } from "node:fs";

const from = "node_modules/pdfjs-dist";
const to = "public/vendor/pdfjs";

rmSync(to, { recursive: true, force: true });
for (const dir of ["cmaps", "iccs", "standard_fonts", "wasm"]) cpSync(`${from}/${dir}`, `${to}/${dir}`, { recursive: true });
cpSync(`${from}/build/pdf.worker.min.mjs`, `${to}/pdf.worker.min.mjs`);

const excalidraw = "public/vendor/excalidraw";
rmSync(excalidraw, { recursive: true, force: true });
cpSync("node_modules/@excalidraw/excalidraw/dist/prod/fonts", `${excalidraw}/fonts`, { recursive: true });
