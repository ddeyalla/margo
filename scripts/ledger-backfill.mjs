// Fills the learner ledger from what the book files already hold: card ratings, quiz attempts, draw-it-back
// attempts, highlights and questions on passages.
// Usage: node scripts/ledger-backfill.mjs
// Safe to run again, and with the app open: events already in the ledger are skipped.
const { loadApp } = await import("./load-app.mjs");
const { backfillLedger, ledgerFile } = await loadApp("lib/server/ledger.ts");

const { books, found, added } = await backfillLedger();
console.log(`${ledgerFile()}: read ${books} book file${books === 1 ? "" : "s"}, found ${found} event${found === 1 ? "" : "s"}, added ${added}.`);
process.exit(0);
