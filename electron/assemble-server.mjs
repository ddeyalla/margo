// Puts the server next to the files it serves, in dist-app/server. `next build` leaves
// public/ and .next/static/ out of .next/standalone, and the server needs both.
import { cpSync, existsSync, rmSync } from "node:fs";

const standalone = ".next/standalone";
const out = "dist-app/server";

if (!existsSync(`${standalone}/server.js`)) {
  console.error("No standalone build. Run `npm run build` first.");
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
cpSync(standalone, out, { recursive: true, verbatimSymlinks: true });
cpSync("public", `${out}/public`, { recursive: true });
cpSync(".next/static", `${out}/.next/static`, { recursive: true });
console.log(`Server assembled in ${out}`);
