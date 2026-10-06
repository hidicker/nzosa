/**
 * Replace a ledger's transactions with a fresh import, keeping every decision.
 *
 * A transaction id is a content hash, which is what makes this safe: a row that
 * is the same row in both files has the same id in both, so the coding, split
 * or match keyed to it still finds it. Anything that does not carry over is
 * reported rather than dropped silently -- an orphaned coding is a decision
 * somebody made that is about to disappear.
 *
 * Run: node tools/swap-transactions.mjs <current.json> <fresh.json> <out.json>
 */
import { readFileSync, writeFileSync } from "node:fs";

const [, , currentPath, freshPath, outPath] = process.argv;
if (!currentPath || !freshPath || !outPath) {
  process.stderr.write("usage: swap-transactions.mjs <current.json> <fresh.json> <out.json>\n");
  process.exit(2);
}

const current = JSON.parse(readFileSync(currentPath, "utf8"));
const fresh = JSON.parse(readFileSync(freshPath, "utf8"));
const ids = new Set(fresh.transactions.map((t) => t.id));

const money = (c) => (c / 100).toFixed(2);
const byId = new Map(current.transactions.map((t) => [t.id, t]));

/** Report what a keyed record loses, and return only what still resolves. */
function carry(name, record) {
  if (record === undefined) return undefined;
  const kept = {};
  const lost = [];
  for (const [id, value] of Object.entries(record)) {
    if (ids.has(id)) kept[id] = value;
    else lost.push(id);
  }
  const total = Object.keys(record).length;
  process.stdout.write(`${name.padEnd(20)} ${String(total).padStart(5)} kept ${String(Object.keys(kept).length).padStart(5)}`);
  process.stdout.write(lost.length === 0 ? "\n" : `  LOST ${lost.length}\n`);
  for (const id of lost) {
    const t = byId.get(id);
    process.stdout.write(
      `    ${id}  ${t ? `${t.date} ${money(t.amount).padStart(10)}  ${t.otherParty}` : "(not in the current ledger either)"}\n`,
    );
  }
  return kept;
}

process.stdout.write(`transactions         ${String(current.transactions.length).padStart(5)} -> ${fresh.transactions.length}\n`);

const swapped = {
  ...current,
  transactions: fresh.transactions,
  // Dedupe decisions are keyed by id like everything else.
  legitimateDuplicates: (current.legitimateDuplicates ?? []).filter((id) => ids.has(id)),
};

for (const part of ["overrides", "splits", "invoiceMatches", "transfers"]) {
  const kept = carry(part, current[part]);
  if (kept !== undefined) swapped[part] = kept;
}

writeFileSync(outPath, JSON.stringify(swapped, null, 2));
process.stdout.write(`\nwritten to ${outPath}\n`);
