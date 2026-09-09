/**
 * Stage two of the demo data: everything a bank export cannot carry.
 *
 * Stage one wrote the bank files and put them through the real importer, so the
 * transaction ids here are genuine content hashes. This adds the chart, the
 * entities, invoices, assets, and the decisions a person would have made --
 * some codings confirmed and many deliberately not, two splits, three invoice
 * matches and one transfer.
 *
 * The result is a book part-way through being done, because that is what a
 * demonstration should show. A finished set of books demonstrates nothing
 * about the work.
 *
 * Run: node tools/make-demo.mjs && node tools/make-demo-ledger.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChartOfAccounts } from "../packages/core/dist/chart.js";
import { parseFixedAssets } from "../packages/core/dist/assets.js";
import { parseXeroInvoices } from "../packages/core/dist/invoices.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "apps/web/public/demo");
const transactions = JSON.parse(readFileSync(join(root, "tools/.demo-transactions.json"), "utf8"));

const TRADING = "02-1234-0056789-000";
const RENTAL = "02-1234-0056789-001";
const CARD = "kea-card-4021";

/** The one bank line matching a description, so a decision can be pinned to it. */
function one(predicate, what) {
  const found = transactions.filter(predicate);
  if (found.length !== 1) {
    throw new Error(`${what}: expected exactly one line, found ${found.length}`);
  }
  return found[0];
}
const on = (date, account) => (t) => t.date === date && t.account === account;

// ---------------------------------------------------------------------------
// Chart of accounts, in the shape Xero exports plus the columns this app adds.
// ---------------------------------------------------------------------------
const chartRows = [
  ["200", "Sales", "Revenue", "15% GST on Income", "Coffee sold wholesale", "Kea Coffee Roasters Limited", "standard"],
  ["210", "Rent received", "Revenue", "GST Exempt", "Residential rent", "17 Rimu Lane", "exempt"],
  ["300", "Cost of goods sold", "Direct Costs", "15% GST on Expenses", "Green beans", "Kea Coffee Roasters Limited", "standard"],
  ["310", "Packaging", "Direct Costs", "15% GST on Expenses", "", "Kea Coffee Roasters Limited", "standard"],
  ["425", "Freight and courier", "Overhead", "15% GST on Expenses", "", "Kea Coffee Roasters Limited", "standard"],
  ["429", "General expenses", "Overhead", "15% GST on Expenses", "", "Kea Coffee Roasters Limited", "standard"],
  ["433", "Insurance", "Overhead", "15% GST on Expenses", "", "Kea Coffee Roasters Limited", "standard"],
  ["437", "Accounting fees", "Overhead", "15% GST on Expenses", "", "Kea Coffee Roasters Limited", "standard"],
  ["445", "Light, power, heating", "Overhead", "15% GST on Expenses", "", "Kea Coffee Roasters Limited", "standard"],
  ["449", "Motor vehicle expenses", "Overhead", "15% GST on Expenses", "Fuel and running costs", "Kea Coffee Roasters Limited", "standard"],
  ["453", "Office expenses", "Overhead", "15% GST on Expenses", "", "Kea Coffee Roasters Limited", "standard"],
  ["458", "Repairs and maintenance", "Overhead", "15% GST on Expenses", "", "Kea Coffee Roasters Limited", "standard"],
  ["461", "Rent paid", "Overhead", "15% GST on Expenses", "The roastery unit", "Kea Coffee Roasters Limited", "standard"],
  ["469", "Subscriptions", "Overhead", "15% GST on Expenses", "", "Kea Coffee Roasters Limited", "standard"],
  ["473", "Advertising", "Overhead", "15% GST on Expenses", "Markets and trade shows", "Kea Coffee Roasters Limited", "standard"],
  ["477", "Telephone and internet", "Overhead", "15% GST on Expenses", "", "Kea Coffee Roasters Limited", "standard"],
  ["481", "Travel", "Overhead", "15% GST on Expenses", "", "Kea Coffee Roasters Limited", "standard"],
  ["600", "Property repairs", "Overhead", "15% GST on Expenses", "Rental repairs", "17 Rimu Lane", "exempt"],
  ["604", "Rates", "Overhead", "15% GST on Expenses", "", "17 Rimu Lane", "exempt"],
  ["608", "Property insurance", "Overhead", "15% GST on Expenses", "", "17 Rimu Lane", "exempt"],
  ["630", "Drawings", "Current Liability", "No GST", "Money taken out", "Kea Coffee Roasters Limited", "out-of-scope"],
  ["710", "Plant and equipment", "Fixed Asset", "15% GST on Expenses", "", "Kea Coffee Roasters Limited", "standard"],
  ["711", "Less accumulated depreciation on Plant and equipment", "Fixed Asset", "No GST", "", "Kea Coffee Roasters Limited", "out-of-scope"],
  ["820", "GST", "Current Liability", "No GST", "The GST control account", "Kea Coffee Roasters Limited", "out-of-scope"],
  ["500", "Depreciation", "Depreciation", "No GST", "", "Kea Coffee Roasters Limited", "out-of-scope"],
];

const q = (v) => `"${String(v).replaceAll('"', '""')}"`;
const chartCsv = [
  "*Code,*Name,*Type,*Tax Code,Description,Dashboard,Expense Claims,Enable Payments,Entity,GST Treatment,Entity Owners,Entity Kind",
  ...chartRows.map(([code, name, type, tax, desc, entity, treatment]) =>
    [code, name, type, tax, desc, "", "", "", entity, treatment,
     entity === "17 Rimu Lane" ? "Ana Whitcombe 50%; Tom Whitcombe 50%" : "",
     entity === "17 Rimu Lane" ? "residential" : "business",
    ].map(q).join(","),
  ),
].join("\n") + "\n";
writeFileSync(join(out, "chart-of-accounts.csv"), chartCsv);

// ---------------------------------------------------------------------------
// Fixed assets, so the depreciation schedule has something to say.
// ---------------------------------------------------------------------------
const assetsCsv = [
  "*AssetName,*AssetNumber,AssetStatus,PurchaseDate,PurchasePrice,AssetType,Description,TrackingCategory1,TrackingOption1,TrackingCategory2,TrackingOption2,SerialNumber,WarrantyExpiry,Book_DepreciationStartDate,Book_CostLimit,Book_ResidualValue,Book_DepreciationMethod,Book_AveragingMethod,Book_Rate,Book_EffectiveLife,Book_OpeningBookAccumulatedDepreciation,Book_BookValue,AccumulatedDepreciation,InvestmentBoost,DepreciationToDate,DisposalDate",
  '"Probat 12kg shop roaster","FA-0001","Registered","12/04/2024","18500.00","Plant and equipment","The main roaster","","","","","","","12/04/2024","","","Straight Line","Full Month","13","","0","0","2405.00","","",""',
  '"Delivery van, 2019 Hiace","FA-0002","Registered","03/08/2024","24000.00","Plant and equipment","","","","","","","","03/08/2024","","","Straight Line","Full Month","20","","0","0","3200.00","","",""',
  '"Packaging sealer","FA-0003","Registered","19/09/2025","3200.00","Plant and equipment","","","","","","","","19/09/2025","","","Straight Line","Full Month","20","","0","0","0","","",""',
  '"Laptop","FA-0004","Registered","05/02/2026","2400.00","Plant and equipment","Office laptop","","","","","","","05/02/2026","","","Straight Line","Full Month","40","","0","0","0","","",""',
].join("\n") + "\n";
writeFileSync(join(out, "assets.csv"), assetsCsv);

// ---------------------------------------------------------------------------
// Invoices. Most settled, two still owed, and one credit note.
// ---------------------------------------------------------------------------
const invoiceRows = [
  ["INV-1001", "Harbour Cafe", "2025-03-28", "2025-04-27", 1265.0, "Wholesale coffee, March", "Paid"],
  ["INV-1002", "Kea Cafe Group", "2025-04-15", "2025-05-15", 2530.0, "Wholesale coffee, April", "Paid"],
  ["INV-1003", "The Roastery Bar", "2025-05-01", "2025-05-31", 977.5, "Wholesale coffee", "Paid"],
  ["INV-1004", "Harbour Cafe", "2025-05-28", "2025-06-27", 1840.0, "Wholesale coffee, May", "Paid"],
  ["INV-1005", "Kea Cafe Group", "2025-06-24", "2025-07-24", 3105.0, "Wholesale coffee, June", "Paid"],
  ["INV-1006", "The Roastery Bar", "2025-07-29", "2025-08-28", 1265.0, "Wholesale coffee", "Paid"],
  ["INV-1007", "Harbour Cafe", "2025-08-27", "2025-09-26", 2185.0, "Wholesale coffee, August", "Paid"],
  ["INV-1008", "Kea Cafe Group", "2025-09-24", "2025-10-24", 1495.0, "Wholesale coffee", "Paid"],
  ["INV-1009", "Harbour Cafe", "2025-10-28", "2025-11-27", 2760.0, "Wholesale coffee, October", "Paid"],
  ["INV-1010", "Kea Cafe Group", "2025-11-25", "2025-12-25", 3450.0, "Christmas order", "Paid"],
  ["INV-1011", "The Roastery Bar", "2026-01-13", "2026-02-12", 1610.0, "Wholesale coffee", "Paid"],
  ["INV-1012", "Harbour Cafe", "2026-02-04", "2026-03-06", 2070.0, "Wholesale coffee, January", "Paid"],
  ["INV-1013", "Kea Cafe Group", "2026-03-03", "2026-04-02", 1840.0, "Wholesale coffee, February", "Paid"],
  // Still owed at balance date: these are what accrual income has and cash does not.
  ["INV-1014", "Harbour Cafe", "2026-03-24", "2026-04-23", 1495.0, "Wholesale coffee, March", "Awaiting Payment"],
  ["INV-1015", "The Roastery Bar", "2026-03-30", "2026-04-29", 862.5, "Wholesale coffee", "Awaiting Payment"],
];
const nz = (iso) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
const invoiceCsv = [
  "ContactName,EmailAddress,POAddressLine1,POAddressLine2,POAddressLine3,POAddressLine4,POCity,PORegion,POPostalCode,POCountry,SAAddressLine1,SAAddressLine2,SAAddressLine3,SAAddressLine4,SACity,SARegion,SAPostalCode,SACountry,InvoiceNumber,Reference,InvoiceDate,DueDate,PlannedDate,Total,TaxTotal,InvoiceAmountPaid,InvoiceAmountDue,InventoryItemCode,Description,Quantity,UnitAmount,Discount,LineAmount,AccountCode,TaxType,TaxAmount,TrackingName1,TrackingOption1,TrackingName2,TrackingOption2,Currency,Type,Sent,Status",
  ...invoiceRows.map(([number, contact, issued, due, total, description, status]) => {
    const tax = Math.round((total * 3) / 23 * 100) / 100;
    const net = Math.round((total - tax) * 100) / 100;
    const paid = status === "Paid" ? total : 0;
    return [
      contact, "", "", "", "", "", "Nelson", "", "7010", "NZ",
      "", "", "", "", "", "", "", "",
      number, "", nz(issued), nz(due), "",
      total.toFixed(4), tax.toFixed(4), paid.toFixed(4), (total - paid).toFixed(4),
      "", description, "1.0000", net.toFixed(4), "", net.toFixed(4),
      "200", "15% GST on Income", tax.toFixed(4),
      "", "", "", "", "NZD", "Sales invoice", "Sent", status,
    ].map(q).join(",");
  }),
].join("\n") + "\n";
writeFileSync(join(out, "invoices.csv"), invoiceCsv);

// ---------------------------------------------------------------------------
// The decisions.
// ---------------------------------------------------------------------------
const overrides = {};
const cents = (n) => Math.round(n * 100);

/** Confirm a coding, the way a person clicking OK would. */
function confirm(transaction, code, note, extra = {}) {
  overrides[transaction.id] = {
    confirmed: true,
    code,
    treatment: "standard",
    side: transaction.amount > 0 ? "sales" : "purchases",
    note,
    at: transaction.date,
    ...extra,
  };
}

// Rent, beans and power are settled decisions -- the same supplier every month,
// looked at once and confirmed. Sales receipts are deliberately left alone.
for (const t of transactions) {
  if (t.account === TRADING && t.otherParty === "Highland Bean Co") {
    confirm(t, "Cost of goods sold - 300", "Green beans for roasting");
  }
  if (t.account === TRADING && t.otherParty === "Rimu Property Trust") {
    confirm(t, "Rent paid - 461", "Monthly rent on the roastery unit");
  }
  if (t.account === TRADING && t.otherParty === "Trustpower") {
    confirm(t, "Light, power, heating - 445", "Power at the roastery");
  }
  if (t.account === RENTAL && t.otherParty === "Beattie tenancy") {
    // Residential rent is an exempt supply, not a zero-rated or standard one.
    confirm(t, "Rent received - 210", "Residential rent, exempt from GST", {
      treatment: "exempt",
      side: "none",
    });
  }
  if (t.account === RENTAL && t.otherParty === "Nelson City Council") {
    confirm(t, "Rates - 604", "Council rates on the rental", {
      treatment: "exempt",
      side: "none",
    });
  }
  if (t.account === CARD && t.otherParty.startsWith("Xero Subscription")) {
    confirm(t, "Subscriptions - 469", "Accounting software");
  }
}

// --- two splits -------------------------------------------------------------
const splits = {};

// One trip to the hardware shop, two different books.
const hardware = one(on("2025-10-21", TRADING), "hardware purchase");
splits[hardware.id] = [
  {
    amount: cents(-517.5),
    code: "Property repairs - 600",
    treatment: "exempt",
    side: "none",
    note: "Fence palings and gate hardware for 17 Rimu Lane",
  },
  {
    amount: cents(-540.5),
    code: "Repairs and maintenance - 458",
    treatment: "standard",
    side: "purchases",
    note: "Shelving and fittings for the roastery",
  },
];

// A phone bill that is not wholly the business's.
const phone = one(on("2025-12-04", CARD), "December phone bill");
splits[phone.id] = [
  {
    amount: cents(-92.58),
    code: "Telephone and internet - 477",
    treatment: "standard",
    side: "purchases",
    note: "Business share, 70%",
  },
  {
    amount: cents(-39.67),
    code: "Drawings - 630",
    treatment: "out-of-scope",
    side: "none",
    note: "Personal share, 30% -- not a business expense",
  },
];

// --- three invoice matches, leaving the rest to be done ---------------------
const invoiceMatches = {};
for (const [date, number] of [
  ["2025-04-03", "INV-1001"],
  ["2025-04-22", "INV-1002"],
  ["2025-05-09", "INV-1003"],
]) {
  const receipt = one(on(date, TRADING), `receipt for ${number}`);
  invoiceMatches[receipt.id] = number;
  overrides[receipt.id] = {
    confirmed: true,
    code: "Sales - 200",
    treatment: "standard",
    side: "sales",
    note: `Settles ${number}. Coded from the invoice.`,
    at: receipt.date,
  };
}

// --- one transfer, both legs ------------------------------------------------
const cardPayment = one(on("2025-10-28", TRADING), "card payment out");
const cardReceipt = one(on("2025-10-28", CARD), "card payment in");
const transfers = {
  [cardPayment.id]: cardReceipt.id,
  [cardReceipt.id]: cardPayment.id,
};

// ---------------------------------------------------------------------------
const chart = parseChartOfAccounts(chartCsv);
const assets = parseFixedAssets(assetsCsv);
const invoices = parseXeroInvoices(invoiceCsv);
if (chart.problems?.length) console.log("chart problems:", chart.problems.slice(0, 3));
if (assets.problems?.length) console.log("asset problems:", assets.problems.slice(0, 3));

const entities = {
  entities: [
    {
      id: "kea-coffee-roasters-limited",
      name: "Kea Coffee Roasters Limited",
      note: "The trading company",
      kind: "business",
      owners: [],
    },
    {
      id: "17-rimu-lane",
      name: "17 Rimu Lane",
      note: "Residential rental, jointly owned",
      kind: "residential",
      owners: [
        { name: "Ana Whitcombe", share: 50 },
        { name: "Tom Whitcombe", share: 50 },
      ],
    },
  ],
  accounts: Object.fromEntries(
    chartRows.map(([code, , , , , entity]) => [
      code,
      entity === "17 Rimu Lane" ? "17-rimu-lane" : "kea-coffee-roasters-limited",
    ]),
  ),
  banks: {
    [TRADING]: ["kea-coffee-roasters-limited"],
    [CARD]: ["kea-coffee-roasters-limited"],
    [RENTAL]: ["17-rimu-lane"],
  },
};

const ledger = {
  version: 1,
  legitimateDuplicates: [],
  transactions,
  overrides,
  splits,
  invoiceMatches,
  transfers,
  entities,
  chart: chart.accounts,
  assets: assets.assets,
  invoices: invoices.invoices,
};
writeFileSync(join(out, "ledger.json"), JSON.stringify(ledger, null, 2));

console.log(`chart:           ${chart.accounts.length} accounts`);
console.log(`assets:          ${assets.assets.length}`);
console.log(`invoices:        ${invoices.invoices.length}`);
console.log(`confirmed:       ${Object.keys(overrides).length} of ${transactions.length} lines`);
console.log(`splits:          ${Object.keys(splits).length}`);
console.log(`invoice matches: ${Object.keys(invoiceMatches).length}`);
console.log(`transfers:       ${Object.keys(transfers).length / 2} pair`);
console.log(`left to code:    ${transactions.length - Object.keys(overrides).length}`);
