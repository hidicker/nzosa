/**
 * Builds the demo data set: an entirely invented small business, complete
 * enough to show every part of the app working.
 *
 * Nothing here is real. The names, accounts and figures are made up, which is
 * the point -- the repository can be published and demonstrated without any
 * client's bank data in it.
 *
 * Bank lines are written as bank exports and then put through the real
 * importer, so the transaction ids are genuine content hashes rather than
 * invented strings. Everything a CSV cannot carry -- splits, confirmed
 * codings, invoice matches, a transfer -- is added afterwards, keyed by those
 * ids.
 *
 * Run: node tools/make-demo.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { importFile } from "../packages/core/dist/importers/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "apps/web/public/demo");
mkdirSync(out, { recursive: true });

const TRADING = "02-1234-0056789-000";
const RENTAL = "02-1234-0056789-001";
const CARD = "kea-card-4021";

/** `d/m/yyyy` as the banks write it. */
const nz = (iso) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

// ---------------------------------------------------------------------------
// The trading account: sales in, costs out, across a full financial year.
// ---------------------------------------------------------------------------
const trading = [
  ["2025-04-03", 1265.0, "", "INV-1001", "Harbour Cafe", "02-4455"],
  ["2025-04-08", -862.5, "Green beans", "", "Highland Bean Co", "02-8811"],
  ["2025-04-11", -184.0, "Packaging", "", "Pack It Ltd", "02-3322"],
  ["2025-04-15", -1150.0, "Rent April", "", "Rimu Property Trust", "02-9911"],
  ["2025-04-22", 2530.0, "", "INV-1002", "Kea Cafe Group", "02-4455"],
  ["2025-04-29", -218.5, "Power", "", "Trustpower", "02-7766"],
  ["2025-05-06", -862.5, "Green beans", "", "Highland Bean Co", "02-8811"],
  ["2025-05-09", 977.5, "", "INV-1003", "The Roastery Bar", "02-1177"],
  ["2025-05-15", -1150.0, "Rent May", "", "Rimu Property Trust", "02-9911"],
  ["2025-05-20", -345.0, "Courier", "", "NZ Post", "02-6655"],
  ["2025-05-28", -218.5, "Power", "", "Trustpower", "02-7766"],
  ["2025-06-04", 1840.0, "", "INV-1004", "Harbour Cafe", "02-4455"],
  ["2025-06-10", -862.5, "Green beans", "", "Highland Bean Co", "02-8811"],
  ["2025-06-16", -1150.0, "Rent June", "", "Rimu Property Trust", "02-9911"],
  ["2025-06-24", -287.5, "Accounting", "", "Fern Advisory", "02-5533"],
  ["2025-07-02", 3105.0, "", "INV-1005", "Kea Cafe Group", "02-4455"],
  ["2025-07-08", -862.5, "Green beans", "", "Highland Bean Co", "02-8811"],
  ["2025-07-15", -1150.0, "Rent July", "", "Rimu Property Trust", "02-9911"],
  ["2025-07-21", -1495.0, "Roaster service", "", "Southern Machinery", "02-2244"],
  ["2025-07-30", -218.5, "Power", "", "Trustpower", "02-7766"],
  ["2025-08-05", 1265.0, "", "INV-1006", "The Roastery Bar", "02-1177"],
  ["2025-08-12", -862.5, "Green beans", "", "Highland Bean Co", "02-8811"],
  ["2025-08-15", -1150.0, "Rent August", "", "Rimu Property Trust", "02-9911"],
  ["2025-08-26", -402.5, "Insurance", "", "Tasman Insurance", "02-4488"],
  ["2025-09-03", 2185.0, "", "INV-1007", "Harbour Cafe", "02-4455"],
  ["2025-09-09", -862.5, "Green beans", "", "Highland Bean Co", "02-8811"],
  ["2025-09-15", -1150.0, "Rent September", "", "Rimu Property Trust", "02-9911"],
  ["2025-09-23", -690.0, "Market stall fees", "", "Nelson Markets", "02-3399"],
  ["2025-10-01", 1495.0, "", "INV-1008", "Kea Cafe Group", "02-4455"],
  ["2025-10-07", -862.5, "Green beans", "", "Highland Bean Co", "02-8811"],
  ["2025-10-15", -1150.0, "Rent October", "", "Rimu Property Trust", "02-9911"],
  ["2025-10-21", -1058.0, "Hardware", "", "Timberline Hardware", "02-7711"],
  ["2025-11-04", 2760.0, "", "INV-1009", "Harbour Cafe", "02-4455"],
  ["2025-11-11", -862.5, "Green beans", "", "Highland Bean Co", "02-8811"],
  ["2025-11-17", -1150.0, "Rent November", "", "Rimu Property Trust", "02-9911"],
  ["2025-11-25", -218.5, "Power", "", "Trustpower", "02-7766"],
  ["2025-12-02", 3450.0, "", "INV-1010", "Kea Cafe Group", "02-4455"],
  ["2025-12-09", -862.5, "Green beans", "", "Highland Bean Co", "02-8811"],
  ["2025-12-15", -1150.0, "Rent December", "", "Rimu Property Trust", "02-9911"],
  ["2026-01-13", -1150.0, "Rent January", "", "Rimu Property Trust", "02-9911"],
  ["2026-01-20", 1610.0, "", "INV-1011", "The Roastery Bar", "02-1177"],
  ["2026-01-27", -862.5, "Green beans", "", "Highland Bean Co", "02-8811"],
  ["2026-02-04", -287.5, "Accounting", "", "Fern Advisory", "02-5533"],
  ["2026-02-11", 2070.0, "", "INV-1012", "Harbour Cafe", "02-4455"],
  ["2026-02-16", -1150.0, "Rent February", "", "Rimu Property Trust", "02-9911"],
  ["2026-02-24", -862.5, "Green beans", "", "Highland Bean Co", "02-8811"],
  ["2026-03-03", -218.5, "Power", "", "Trustpower", "02-7766"],
  ["2026-03-10", 1840.0, "", "INV-1013", "Kea Cafe Group", "02-4455"],
  ["2026-03-16", -1150.0, "Rent March", "", "Rimu Property Trust", "02-9911"],
  ["2026-03-24", -862.5, "Green beans", "", "Highland Bean Co", "02-8811"],
  // Paying the card off. The other leg is on the card account below, so the
  // pair can be joined as a transfer.
  ["2025-10-28", -1284.35, "Card payment", "", "BNZCREDITCDS", CARD],
];

// ---------------------------------------------------------------------------
// The rental: rent in, the costs of holding a house out.
// ---------------------------------------------------------------------------
const rental = [
  ["2025-04-04", 2600.0, "Rent", "17 Rimu Lane", "Beattie tenancy", "02-1199"],
  ["2025-04-18", -1240.0, "Rates", "", "Nelson City Council", "02-5511"],
  ["2025-05-02", 2600.0, "Rent", "17 Rimu Lane", "Beattie tenancy", "02-1199"],
  ["2025-05-30", 2600.0, "Rent", "17 Rimu Lane", "Beattie tenancy", "02-1199"],
  ["2025-06-27", 2600.0, "Rent", "17 Rimu Lane", "Beattie tenancy", "02-1199"],
  ["2025-07-14", -1480.0, "House insurance", "", "Tasman Insurance", "02-4488"],
  ["2025-07-25", 2600.0, "Rent", "17 Rimu Lane", "Beattie tenancy", "02-1199"],
  ["2025-08-22", 2600.0, "Rent", "17 Rimu Lane", "Beattie tenancy", "02-1199"],
  ["2025-09-19", 2600.0, "Rent", "17 Rimu Lane", "Beattie tenancy", "02-1199"],
  ["2025-10-17", 2600.0, "Rent", "17 Rimu Lane", "Beattie tenancy", "02-1199"],
  ["2025-10-24", -1240.0, "Rates", "", "Nelson City Council", "02-5511"],
  ["2025-11-14", 2600.0, "Rent", "17 Rimu Lane", "Beattie tenancy", "02-1199"],
  ["2025-11-28", -862.5, "Plumbing repair", "", "Kahu Plumbing", "02-6644"],
  ["2025-12-12", 2600.0, "Rent", "17 Rimu Lane", "Beattie tenancy", "02-1199"],
  ["2026-01-16", 2600.0, "Rent", "17 Rimu Lane", "Beattie tenancy", "02-1199"],
  ["2026-02-13", 2600.0, "Rent", "17 Rimu Lane", "Beattie tenancy", "02-1199"],
  ["2026-03-13", 2600.0, "Rent", "17 Rimu Lane", "Beattie tenancy", "02-1199"],
  ["2026-03-20", -517.5, "Gutter clean", "", "Topline Roofing", "02-2277"],
];

// ---------------------------------------------------------------------------
// The card: small things, and the other half of that transfer.
// ---------------------------------------------------------------------------
const card = [
  ["2025-10-28", 1284.35, "PAYMENT - THANK YOU", "", "", "PMT"],
  ["2025-04-09", -29.9, "Xero Subscription", "Wellington", "", "PUR"],
  ["2025-05-09", -29.9, "Xero Subscription", "Wellington", "", "PUR"],
  ["2025-06-09", -29.9, "Xero Subscription", "Wellington", "", "PUR"],
  ["2025-07-09", -29.9, "Xero Subscription", "Wellington", "", "PUR"],
  ["2025-08-09", -29.9, "Xero Subscription", "Wellington", "", "PUR"],
  ["2025-09-09", -29.9, "Xero Subscription", "Wellington", "", "PUR"],
  ["2025-04-16", -87.4, "Cafe supplies", "Nelson", "", "PUR"],
  ["2025-05-21", -142.6, "Fuel", "Richmond", "", "PUR"],
  ["2025-06-18", -63.25, "Cafe supplies", "Nelson", "", "PUR"],
  ["2025-07-23", -210.45, "Airline ticket", "Auckland", "", "PUR"],
  ["2025-08-14", -55.2, "Stationery", "Nelson", "", "PUR"],
  ["2025-09-26", -178.25, "Fuel", "Richmond", "", "PUR"],
  ["2025-10-15", -395.6, "Trade show stand", "Christchurch", "", "PUR"],
  ["2025-11-19", -92.0, "Cafe supplies", "Nelson", "", "PUR"],
  ["2025-12-04", -132.25, "Phone and internet", "Nelson", "", "PUR"],
  ["2026-01-22", -46.0, "Cafe supplies", "Nelson", "", "PUR"],
  ["2026-02-19", -167.9, "Fuel", "Richmond", "", "PUR"],
  ["2026-03-05", -132.25, "Phone and internet", "Nelson", "", "PUR"],
];

const q = (value) => `"${String(value).replaceAll('"', '""')}"`;

function accountCsv(name, account, rows) {
  const header =
    "Date,Amount,CCY,Serial,Trn,Particulars,Code,Reference,Other Party,Origin,Type,Batch,Other Party Account";
  const body = rows
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, amount, particulars, reference, party, otherAccount], i) =>
      [
        nz(date),
        amount.toFixed(2),
        "NZD",
        "",
        String(i % 1000).padStart(3, "0"),
        particulars,
        "",
        reference,
        party,
        "02-1234",
        amount < 0 ? "BP" : "DC",
        "0000",
        otherAccount,
      ]
        .map(q)
        .join(","),
    );
  return `${name} - ${account}\n${header}\n${body.join("\n")}\n`;
}

function cardCsv(rows) {
  const header = "Date,Amount,Payee,Particulars,Code,Reference,Tran Type,Processed Date";
  const body = rows
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, amount, payee, particulars, reference, type]) =>
      [nz(date), amount.toFixed(2), payee, particulars, "", reference, type, nz(date)].join(","),
    );
  return `${header}\n${body.join("\n")}\n`;
}

const files = {
  "bank-trading.csv": accountCsv("Kea Coffee Roasters Trading", TRADING, trading),
  "bank-rental.csv": accountCsv("17 Rimu Lane Rental", RENTAL, rental),
  "bank-card.csv": cardCsv(card),
};
for (const [name, text] of Object.entries(files)) {
  writeFileSync(join(out, name), text);
}

// --- put them through the real importer, for genuine ids --------------------
const imported = [];
for (const [name, text] of Object.entries(files)) {
  const result = importFile(text, {
    file: name,
    ...(name === "bank-card.csv" ? { account: CARD } : {}),
    defaultCurrency: "NZD",
    dayFirst: true,
  });
  if (result.transactions.length === 0) {
    throw new Error(`${name} imported nothing -- check the format`);
  }
  imported.push(...result.transactions);
}

console.log(`bank lines:      ${imported.length}`);
for (const account of [TRADING, RENTAL, CARD]) {
  console.log(`  ${account.padEnd(22)} ${imported.filter((t) => t.account === account).length}`);
}
// An intermediate for stage two, not part of the published demo folder.
writeFileSync(join(root, "tools/.demo-transactions.json"), JSON.stringify(imported, null, 2));
