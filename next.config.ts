import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* The Mac app opens the dev server at 127.0.0.1 rather than localhost. */
  allowedDevOrigins: ["127.0.0.1"],
  cacheComponents: true,
  partialPrefetching: true,
  /* A self-contained server for the Mac app, in .next/standalone. */
  output: "standalone",
  /* Build output and downloaded models never belong in the server bundle, whatever a path call looks like. */
  outputFileTracingExcludes: { "*": ["./dist-app/**", "./models/**", "./data/**"] },
  /* Read by path at run time, so tracing cannot see them. */
  outputFileTracingIncludes: {
    "/api/books/\\[bookId\\]/cards": ["./lib/server/cards/prompt.md"],
    "/api/speech/transcribe": ["./lib/server/speech-process.cjs", "./node_modules/sherpa-onnx-node/**", "./node_modules/sherpa-onnx-darwin-arm64/**"],
    "/api/books/\\[bookId\\]/cover": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/standard_fonts/**",
      "./node_modules/pdfjs-dist/cmaps/**",
      "./node_modules/pdfjs-dist/wasm/**",
    ],
    /* Search reads PDF text with the same pdf.js as covers. */
    "/api/search": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/standard_fonts/**",
      "./node_modules/pdfjs-dist/cmaps/**",
      "./node_modules/pdfjs-dist/wasm/**",
    ],
  },
  /* No Next badge in the corner while running `npm run dev`; error overlays still show. */
  devIndicators: false,
  /* Covers are drawn on the server with pdf.js and a native canvas, and voice input decodes with a native addon: all loaded by Node rather than bundled. */
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas", "sherpa-onnx-node"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
