// Loads the app's server code outside Next, for the scripts that run beside it: the MCP server, the ledger backfill.
//
// It reads the same folders the app does. DATA_DIR, BOOKS_DIR and NOTES_DIR come from the environment first,
// then from .env.local in this repo, the way `npm run dev` gets them; with neither, the data folder is ./data
// in this repo, whatever folder the script was started in.
import fs from "node:fs";
import path from "node:path";
import { createJiti } from "../node_modules/jiti/lib/jiti.mjs";

const repo = path.resolve(import.meta.dirname, "..");

const FOLDERS = ["DATA_DIR", "BOOKS_DIR", "NOTES_DIR"];
try {
  for (const line of fs.readFileSync(path.join(repo, ".env.local"), "utf8").split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || !FOLDERS.includes(match[1]) || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
} catch {}
process.env.DATA_DIR ||= path.join(repo, "data");

const jiti = createJiti(import.meta.url, { alias: { "@": repo } });

/** A module of the app by its path from the repo's root, such as "lib/server/ledger.ts". */
export const loadApp = (file) => jiti.import(path.join(repo, file));
