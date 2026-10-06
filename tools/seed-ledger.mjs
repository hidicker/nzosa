/**
 * Turn the old single-file ledger into a ledger folder.
 *
 * The app used to keep everything in one `ledger.json` beside a handful of
 * CSVs, and reload them whenever the browser was empty. The folder is the truth
 * now, and it holds one file per part -- so this splits what exists into the
 * shape the app writes, once, rather than asking anyone to do it by hand.
 *
 * Transactions come out on their own because they never change after import
 * and are almost all of the bulk; the decisions made about them go together
 * because they change constantly and are small.
 *
 * Run: node tools/seed-ledger.mjs <old-data-folder> <new-ledger-folder>
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeMeta, writePart } from "../apps/web/ledger-folder.js";
import { parseChartOfAccounts } from "../packages/core/dist/chart.js";
import { parseFixedAssets } from "../packages/core/dist/assets.js";
import { parseXeroInvoices, parseXeroAllocations } from "../packages/core/dist/invoices.js";
import { parseXeroJournalReport } from "../packages/core/dist/journals.js";

const [, , from, to] = process.argv;
if (!from || !to) {
  process.stderr.write("usage: seed-ledger.mjs <old-data-folder> <new-ledger-folder>\n");
  process.exit(2);
}

const read = (name) => {
  const file = join(from, name);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
};

const ledger = JSON.parse(read("ledger.json") ?? "{}");
const say = (part, n) => process.stdout.write(`  ${part.padEnd(14)} ${n}\n`);

// --- the bank lines, which never change again --------------------------------
const transactions = ledger.transactions ?? [];
writePart(to, "transactions", transactions);
say("transactions", transactions.length);

// --- everything a person decided about them ----------------------------------
const decisions = {
  overrides: ledger.overrides ?? {},
  splits: ledger.splits ?? {},
  invoiceMatches: ledger.invoiceMatches ?? {},
  transfers: ledger.transfers ?? {},
  legitimateDuplicates: ledger.legitimateDuplicates ?? [],
  varianceNotes: ledger.varianceNotes ?? [],
  varianceAccounts: ledger.varianceAccounts ?? [],
  taxExtras: ledger.taxExtras ?? [],
};
writePart(to, "decisions", decisions);
say("decisions", `${Object.keys(decisions.overrides).length} codings, ${Object.keys(decisions.splits).length} splits`);

// --- the reference files, parsed once into the shape the app holds -----------
const chartText = read("chart-of-accounts.csv");
const chart = chartText ? parseChartOfAccounts(chartText).accounts : (ledger.chart ?? []);
writePart(to, "chart", chart);
say("chart", chart.length);

const assetsText = read("assets.csv");
const assets = assetsText ? parseFixedAssets(assetsText).assets : (ledger.assets ?? []);
writePart(to, "assets", assets);
say("assets", assets.length);

const invoicesText = read("invoices.csv");
const invoices = invoicesText ? parseXeroInvoices(invoicesText).invoices : (ledger.invoices ?? []);
writePart(to, "invoices", invoices);
say("invoices", invoices.length);

const allocationsText = read("allocations.csv");
const allocations = allocationsText
  ? parseXeroAllocations(allocationsText).allocations
  : (ledger.allocations ?? []);
writePart(to, "allocations", allocations);
say("allocations", allocations.length);

const journalsText = read("journals.csv");
const journals = journalsText ? parseXeroJournalReport(journalsText).journals : (ledger.journals ?? []);
writePart(to, "journals", journals);
say("journals", journals.length);

const rules = JSON.parse(read("rules.json") ?? "null");
if (rules) {
  writePart(to, "rules", rules);
  say("rules", (rules.rules ?? []).length);
}

writePart(to, "filed", ledger.filedReturns ?? []);
say("filed", (ledger.filedReturns ?? []).length);

writePart(to, "reference", ledger.reference ?? []);
writePart(to, "entities", ledger.entities ?? {});
writePart(to, "events", []);

writeMeta(to, { name: "My books", created: new Date().toISOString() });
process.stdout.write(`\nwritten to ${to}\n`);
