import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored third-party code, loaded at runtime and never bundled.
    "public/vendor/**",
    // The Mac app shell is plain Node (CommonJS), outside the Next build.
    "electron/**",
    // The speech model's process, also plain Node, started by lib/server/speech.ts.
    "lib/server/speech-process.cjs",
    "lib/server/voice-process.cjs",
    "lib/server/voice-text.cjs",
    "dist-app/**",
    // Agent worktrees: other checkouts of this repo, each with its own build output.
    ".claude/**",
  ]),
]);

export default eslintConfig;
