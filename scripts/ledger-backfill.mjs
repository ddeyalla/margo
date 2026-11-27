// Fills the learner ledger from what the book files already hold: card ratings, quiz attempts, draw-it-back
// attempts, highlights and questions on passages.
// Usage: node scripts/ledger-backfill.mjs [--dry-run]
//   --dry-run  Reads and counts, writes nothing: what would be added, by event type and evidence strength.
// Safe to run again, and with the app open: it only appends, and events already in the ledger are skipped.
// Back up the data folder first if you want a way back; the book files are never touched.
const { loadApp } = await import("./load-app.mjs");
const { backfillLedger, ledgerFile } = await loadApp("lib/server/ledger.ts");

const dryRun = process.argv.includes("--dry-run");
const { books, found, added, bySource, byStrength } = await backfillLedger(undefined, { dryRun });
console.log(`${ledgerFile()}: read ${books} book file${books === 1 ? "" : "s"}, found ${found} event${found === 1 ? "" : "s"}, ${dryRun ? "would add" : "added"} ${added}.`);
console.log("by event type:", JSON.stringify(bySource));
console.log("by evidence strength:", JSON.stringify(byStrength));
process.exit(0);
