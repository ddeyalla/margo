// Registers the app's MCP server (scripts/mcp-server.mjs) with Claude Code and Codex, for every project on
// this machine. Run it again after moving the repo; it replaces the earlier registration.
// Usage: npm run mcp:setup [-- --data-dir <folder>]
//   --data-dir  The data folder the server reads, when it isn't the one in .env.local or ./data. The Mac app
//               keeps its data in ~/Library/Application Support/Margo/data.
import { spawnSync } from "node:child_process";
import path from "node:path";

const NAME = "margo";
/** The name before the rename to Margo. Setup removes it, so the old and new servers never both run. */
const OLD_NAME = "rigg-learn";
const server = path.resolve(import.meta.dirname, "mcp-server.mjs");

const flag = process.argv.indexOf("--data-dir");
const dataDir = flag === -1 ? null : process.argv[flag + 1];
if (flag !== -1 && (!dataDir || !path.isAbsolute(dataDir))) {
  console.error("--data-dir takes an absolute path.");
  process.exit(1);
}
const env = dataDir ? [`DATA_DIR=${path.resolve(dataDir)}`] : [];

const run = (command, args) => spawnSync(command, args, { encoding: "utf8" });

/** Each agent's CLI: how to drop an earlier registration, and how to add this one. */
const AGENTS = [
  {
    label: "Claude Code",
    command: "claude",
    remove: (name) => ["mcp", "remove", "--scope", "user", name],
    add: ["mcp", "add", "--scope", "user", NAME, ...env.flatMap((pair) => ["--env", pair]), "--", "node", server],
  },
  {
    label: "Codex",
    command: "codex",
    remove: (name) => ["mcp", "remove", name],
    add: ["mcp", "add", NAME, ...env.flatMap((pair) => ["--env", pair]), "--", "node", server],
  },
];

let failed = false;
for (const agent of AGENTS) {
  if (run(agent.command, ["--version"]).error) {
    console.log(`${agent.label}: not installed, skipped.`);
    continue;
  }
  for (const name of [OLD_NAME, NAME]) run(agent.command, agent.remove(name));
  const added = run(agent.command, agent.add);
  if (added.status === 0) {
    console.log(`${agent.label}: registered "${NAME}".`);
  } else {
    failed = true;
    console.error(`${agent.label}: could not register.\n${(added.stderr || added.stdout || String(added.error)).trim()}`);
  }
}
console.log(`\nThe server is: node ${server}${dataDir ? `\nIt reads the data folder: ${path.resolve(dataDir)}` : ""}`);
process.exit(failed ? 1 : 0);
