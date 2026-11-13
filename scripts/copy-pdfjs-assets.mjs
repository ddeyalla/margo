// Copies pdf.js runtime assets into public/ so the browser can load them by
// URL. They come from the installed pdfjs-dist, so they always match its version.
import { cpSync, rmSync } from "node:fs";

const from = "node_modules/pdfjs-dist";
const to = "public/vendor/pdfjs";

rmSync(to, { recursive: true, force: true });
for (const dir of ["cmaps", "iccs", "standard_fonts", "wasm"]) cpSync(`${from}/${dir}`, `${to}/${dir}`, { recursive: true });
cpSync(`${from}/build/pdf.worker.min.mjs`, `${to}/pdf.worker.min.mjs`);
