import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  /* A self-contained server for the Mac app, in .next/standalone. */
  output: "standalone",
  /* Read by path at run time, so tracing cannot see them. */
  outputFileTracingIncludes: {
    "/api/books/\\[bookId\\]/cards": ["./lib/server/cards/prompt.md"],
    "/api/books/\\[bookId\\]/cover": [
      "./node_modules/pdfjs-dist/standard_fonts/**",
      "./node_modules/pdfjs-dist/cmaps/**",
      "./node_modules/pdfjs-dist/wasm/**",
    ],
  },
  /* Covers are drawn on the server with pdf.js and a native canvas, loaded by Node rather than bundled. */
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
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
