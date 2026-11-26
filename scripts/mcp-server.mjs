// The app's tools as an MCP server on stdio, for Claude Code, Codex and other agents.
// Usage: node scripts/mcp-server.mjs
// It runs on its own: neither the Next server nor the Mac app needs to be open. `npm run mcp:setup` registers it.
// It reads the same folders the app does; scripts/load-app.mjs says where they come from.

// stdout carries the protocol and nothing else: anything the app logs goes to stderr.
console.log = console.error;
console.info = console.error;
console.warn = console.error;

const { loadApp } = await import("./load-app.mjs");
const { serve } = await loadApp("lib/server/mcp/server.ts");
const { ledgerIdle } = await loadApp("lib/server/ledger.ts");
await serve(process.stdin, process.stdout);
// A parked question's ledger line may still be on its way to the file.
await ledgerIdle();
// Background work, such as reading books for search, ends with the connection.
process.exit(0);
