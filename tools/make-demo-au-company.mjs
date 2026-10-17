/**
 * Invented Australian company books for the online demo: a plumbing business
 * run as a Pty Ltd, registered for GST, with a director and an apprentice on
 * fortnightly pay, for the year to 30 June 2026.
 *
 * Shows what the sole trader's books do not: a company paying its own tax
 * (PAYG instalments during the year, company tax at the base rate entity
 * rate), a director on the payroll rather than taking drawings, share capital,
 * and plant depreciated in the company's own name.
 *
 * One `ledger.json` in apps/web/public/demo/au-company/. Every name, number
 * and figure is invented.
 *
 * Built to add up: opening balances balance, each BAS paid is the GST the
 * quarter's lines carry, and the script refuses to write a set whose bank
 * account would go overdrawn.
 *
 * Run: node tools/make-demo-au-company.mjs (after building packages/core)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auPayLine, earnedBeforePay, superDueDate } from "../packages/core/dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "apps/web/public/demo/au-company");

const FROM = "2025-07-01";
const TO = "2026-06-30";

const company = {
  id: "plumbing",
  name: "Southern Cross Plumbing Pty Ltd",
  kind: "business",
  structure: "company",
  owners: [
    { name: "Liam O'Brien", percent: 50 },
    { name: "Grace O'Brien", percent: 50 },
  ],
  gstRegistered: true,
};

// The Australian starter chart's codes and names, with a few more for this business.
// [code, name, type, tax code, treatment]
const ACCOUNTS = [
  ["200", "Sales", "Revenue", "GST on Income", "standard"],
  ["270", "Interest Income", "Revenue", "Input Taxed", "exempt"],
  ["310", "Cost of Goods Sold", "Direct Costs", "GST on Expenses", "standard"],
  ["404", "Bank Fees", "Expense", "GST Free Expenses", "zero-rated"],
  ["412", "Consulting & Accounting", "Expense", "GST on Expenses", "standard"],
  ["416", "Depreciation", "Expense", "BAS Excluded", "out-of-scope"],
  ["425", "Freight & Courier", "Expense", "GST on Expenses", "standard"],
  ["433", "Insurance", "Expense", "GST on Expenses", "standard"],
  ["449", "Motor Vehicle Expenses", "Expense", "GST on Expenses", "standard"],
  ["461", "Printing & Stationery", "Expense", "GST on Expenses", "standard"],
  ["469", "Rent", "Expense", "GST on Expenses", "standard"],
  ["473", "Repairs and Maintenance", "Expense", "GST on Expenses", "standard"],
  ["477", "Wages and Salaries", "Expense", "BAS Excluded", "out-of-scope"],
  ["478", "Superannuation", "Expense", "BAS Excluded", "out-of-scope"],
  ["485", "Subscriptions", "Expense", "GST on Expenses", "standard"],
  ["489", "Telephone & Internet", "Expense", "GST on Expenses", "standard"],
  ["497", "Licences and registrations", "Expense", "GST Free Expenses", "zero-rated"],
  ["610", "Accounts Receivable", "Accounts Receivable", "BAS Excluded", "out-of-scope"],
  ["750", "Plant & Equipment", "Fixed Asset", "GST on Capital", "standard"],
  ["751", "Less Accumulated Depreciation on Plant & Equipment", "Fixed Asset", "BAS Excluded", "out-of-scope"],
  ["800", "Accounts Payable", "Accounts Payable", "BAS Excluded", "out-of-scope"],
  ["804", "Wages Payable", "Current Liability", "BAS Excluded", "out-of-scope"],
  ["820", "GST", "Current Liability", "BAS Excluded", "out-of-scope"],
  ["825", "PAYG Withholdings Payable", "Current Liability", "BAS Excluded", "out-of-scope"],
  ["826", "Superannuation Payable", "Current Liability", "BAS Excluded", "out-of-scope"],
  ["830", "Income Tax Payable", "Current Liability", "BAS Excluded", "out-of-scope"],
  ["960", "Retained Earnings", "Equity", "BAS Excluded", "out-of-scope"],
  ["970", "Share Capital", "Equity", "BAS Excluded", "out-of-scope"],
  ["980", "Dividends Paid", "Equity", "BAS Excluded", "out-of-scope"],
];
const account = new Map(ACCOUNTS.map(([code, name, type, taxCode, treatment]) => [code, { code, name, type, taxCode, treatment }]));

const BUSINESS = "auco-business";
const BANKS = new Map([[BUSINESS, { label: "Business Everyday ••5190", entity: company.id }]]);

const lines = [];
const line = (date, amount, payee, code, note) => {
  if (date < FROM || date > TO) throw new Error(`${date} is outside the period`);
  if (code !== undefined && !account.has(code)) throw new Error(`no account ${code}`);
  lines.push({ bank: BUSINESS, date, amount, payee, code, note: note ?? "" });
};
// July to June: months 7-12 are 2025, 1-6 are 2026.
const day = (m, d) => `${m >= 7 ? 2025 : 2026}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const cents = (dollars) => Math.round(dollars * 100);
const MONTHS = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];

// --- the work ----------------------------------------------------------------------
// Each month: a builder's progress claims, a property manager's call-outs and a
// few households, GST in. Figures are a whole number of elevenths of a dollar.
const customers = [
  ["Bellarine Homes", 6, 15004],
  ["Corio Property Management", 14, 4895],
  ["Barwon Heads Bakery", 19, 1848],
  ["Ocean Grove Dental", 23, 2552],
];
MONTHS.forEach((m, i) => {
  for (const [who, d, base] of customers) {
    // A little seasonal: more hot water systems in winter.
    const swing = 1 + 0.08 * Math.cos(((i - 0) / 12) * 2 * Math.PI);
    line(day(m, d), cents(Math.round((base * swing) / 11) * 11), who, "200", "Plumbing work, incl GST");
  }
});

for (const m of MONTHS) {
  line(day(m, 1), -cents(2420), "Geelong Trade Units", "469", "Workshop rent, incl GST");
  line(day(m, 8), -cents(Math.round(3600 + 400 * Math.sin(m))), "Reece Plumbing", "310", "Fittings and pipe, incl GST");
  line(day(m, 21), -cents(Math.round(1150 + 200 * Math.cos(m))), "Tradelink", "310", "Hot water units and tapware, incl GST");
  line(day(m, 10), -cents(139), "Telstra", "489", "Mobiles and internet, incl GST");
  line(day(m, 12), -cents(65), "Tradify", "485", "Job management software, incl GST");
  line(day(m, 27), -cents(12), "Account keeping fee", "404", "Bank fee");
}
for (const [m, d, amount] of [[7, 17, 162.4], [8, 14, 171.9], [9, 11, 158.3], [10, 16, 166.75], [11, 13, 174.2], [12, 11, 169.6],
  [1, 15, 160.85], [2, 12, 172.3], [3, 12, 165.4], [4, 16, 168.9], [5, 14, 176.15], [6, 11, 163.7]]) {
  line(day(m, d), -cents(amount), "Ampol", "449", "Fuel for the vans, incl GST");
}
line(day(7, 20), -cents(3366), "Allianz Business", "433", "Public liability and tools insurance, incl GST");
line(day(8, 4), -cents(1896.3), "VicRoads", "449", "Registration, two vans");
line(day(9, 3), -cents(468), "Victorian Building Authority", "497", "Plumbing licence renewal");
line(day(10, 22), -cents(1210), "Barwon Accountants", "412", "Company tax return and financial statements, incl GST");
line(day(4, 9), -cents(495), "Barwon Accountants", "412", "BAS review, incl GST");
line(day(11, 5), -cents(682), "Corio Auto Service", "449", "Van service, incl GST");
line(day(3, 18), -cents(745.8), "Corio Auto Service", "449", "Van service and tyres, incl GST");
line(day(12, 2), -cents(214.5), "Officeworks", "461", "Job cards and printer ink, incl GST");
line(day(2, 11), -cents(88), "StarTrack", "425", "Freight on a hot water unit, incl GST");
line(day(5, 7), -cents(352), "Total Tools", "473", "Drain machine service, incl GST");
// A drain camera: a capital purchase on the BAS (G10), depreciated in the company's books.
line(day(9, 15), -cents(8800), "Total Tools", "750", "Drain inspection camera, incl GST");
line(day(12, 31), cents(42.6), "Interest", "270", "Business savings interest");
line(day(6, 30), cents(51.2), "Interest", "270", "Business savings interest");
// Left for the demonstration: lines nobody has coded yet.
line(day(6, 4), -cents(129.95), "Bunnings Warehouse", undefined);
line(day(6, 16), -cents(59), "Xero Australia", undefined);
line(day(6, 19), cents(990), "Osko payment from K Nguyen", undefined);
line(day(6, 24), -cents(320), "WorkSafe Victoria", undefined);

// --- the director and the apprentice, paid each second Thursday -----------------------
const employees = [
  {
    id: "emp-liam",
    name: "Liam O'Brien",
    taxFreeThreshold: true,
    tfnProvided: true,
    superFund: "AustralianSuper",
    payFrequency: "fortnightly",
    usualGross: cents(2600),
  },
  {
    id: "emp-noah",
    name: "Noah Kelly",
    taxFreeThreshold: true,
    tfnProvided: true,
    studyLoan: true,
    superFund: "Cbus",
    payFrequency: "fortnightly",
    usualGross: cents(1420),
  },
];
const payRuns = [];
for (let n = 0; ; n += 1) {
  const pay = new Date(Date.UTC(2025, 6, 10 + 14 * n));
  const payDate = pay.toISOString().slice(0, 10);
  if (payDate > TO) break;
  const start = new Date(pay.getTime() - 13 * 864e5).toISOString().slice(0, 10);
  const run = { id: `run-${payDate}`, payDate, periodStart: start, periodEnd: payDate, lines: [] };
  for (const e of employees) {
    const one = auPayLine(e, e.usualGross, payDate, earnedBeforePay(payRuns, e.id, payDate));
    run.lines.push(one);
    line(payDate, -one.net, e.name, "804", "Net pay");
  }
  payRuns.push(run);
}

// --- each BAS: the GST the quarter's lines carry, PAYG withheld and the company's instalment --
const quarters = [
  { from: "2025-07-01", to: "2025-09-30", paid: "2025-10-28" },
  { from: "2025-10-01", to: "2025-12-31", paid: "2026-02-27" },
  { from: "2026-01-01", to: "2026-03-31", paid: "2026-04-28" },
];
for (const q of quarters) {
  let sales = 0;
  let purchases = 0;
  for (const one of lines) {
    if (one.code === undefined || one.date < q.from || one.date > q.to) continue;
    if (account.get(one.code).treatment !== "standard") continue;
    if (one.amount > 0) sales += one.amount;
    else purchases -= one.amount;
  }
  const net = Math.round(sales / 11) - Math.round(purchases / 11);
  const span = `${q.from.slice(0, 7)} to ${q.to.slice(0, 7)}`;
  if (net > 0) line(q.paid, -net, "ATO", "820", `BAS ${span}, GST`);
  else if (net < 0) line(q.paid, -net, "ATO", "820", `BAS ${span}, GST refund`);
  const withheld = payRuns
    .filter((r) => r.payDate >= q.from && r.payDate <= q.to)
    .reduce((sum, r) => sum + r.lines.reduce((s, l) => s + l.payg, 0), 0);
  if (withheld > 0) line(q.paid, -withheld, "ATO", "825", `BAS ${span}, PAYG withheld`);
  // The company's own income tax, paid ahead at the rate the ATO notified.
  line(q.paid, -cents(3100), "ATO", "830", `BAS ${span}, PAYG instalment`);
}
// Super for each quarter, paid to the funds by its due date (before payday super).
for (const q of [...quarters, { from: "2026-04-01", to: "2026-06-30" }]) {
  const owed = payRuns
    .filter((r) => r.payDate >= q.from && r.payDate <= q.to)
    .reduce((sum, r) => sum + r.lines.reduce((s, l) => s + l.superGuarantee, 0), 0);
  const due = superDueDate(q.to);
  if (owed > 0 && due <= TO) line(due, -owed, "Super clearing house", "826", "Super guarantee, both employees");
}
// A fully franked interim dividend to the two shareholders.
line(day(12, 15), -cents(10000), "Liam O'Brien", "980", "Interim dividend, fully franked");
line(day(12, 15), -cents(10000), "Grace O'Brien", "980", "Interim dividend, fully franked");
// Last year's company tax, the balance paid when the return was assessed.
line(day(12, 1), -cents(3120), "ATO", "830", "Company tax 2024-25, balance");

// --- put it together -----------------------------------------------------------
// Last year's tax still owed, the company's capital and what it kept.
const opening = { [BUSINESS]: cents(41250), "830": -cents(3120), "970": -cents(100), "960": -cents(38030) };
if (Object.values(opening).reduce((s, v) => s + v, 0) !== 0) throw new Error("opening balances do not balance");

const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
let running = opening[BUSINESS];
const transactions = [];
const overrides = {};
sorted.forEach((one, i) => {
  const id = `auco-${String(i + 1).padStart(4, "0")}`;
  transactions.push({
    id,
    occurrence: 1,
    date: one.date,
    amount: one.amount,
    currency: "AUD",
    serial: "",
    trn: "",
    particulars: one.note,
    code: "",
    reference: "",
    otherParty: one.payee,
    origin: "",
    type: one.amount < 0 ? "DEBIT" : "CREDIT",
    batch: "",
    otherPartyAccount: "",
    account: one.bank,
    extras: { accountLabel: BANKS.get(one.bank).label },
    source: { importer: "invented", file: "au-company-demo.csv", line: i + 1 },
  });
  running += one.amount;
  if (running < 0) throw new Error(`the account goes overdrawn on ${one.date}`);
  if (one.code !== undefined) {
    const a = account.get(one.code);
    const side = a.code === "820" || a.type === "Equity" || a.type === "Current Liability" ? "none" : one.amount > 0 ? "sales" : "purchases";
    overrides[id] = {
      confirmed: true,
      code: `${a.name} - ${a.code}`,
      treatment: a.treatment,
      side,
      note: one.note || a.name,
      at: one.date,
    };
  }
});

// Example AI answers, written by hand in the shape a model returns.
const idOf = (payee) => {
  const found = transactions.find((t) => t.otherParty === payee && overrides[t.id] === undefined);
  if (found === undefined) throw new Error(`no uncoded line for ${payee}`);
  return found.id;
};
const exampleAiSuggestions = [
  {
    id: idOf("Bunnings Warehouse"),
    code: "310",
    confidence: 0.72,
    because: "Hardware bought by a plumbing company: most likely parts for a job, with GST in it.",
    caution: "If it was a tool kept for use, it is an expense or an asset rather than a job's cost.",
  },
  {
    id: idOf("Xero Australia"),
    code: "485",
    confidence: 0.9,
    because: "Accounting software paid monthly: a subscription, with GST from an Australian supplier.",
  },
  {
    id: idOf("Osko payment from K Nguyen"),
    code: "200",
    confidence: 0.6,
    because: "Money in by Osko from a person: most likely a household paying for a job.",
    caution: "Match it to an invoice if one was sent; a sale's GST is one eleventh of it.",
  },
  {
    id: idOf("WorkSafe Victoria"),
    code: "433",
    confidence: 0.82,
    because: "WorkSafe's premium is workers compensation insurance, which an employer in Victoria must hold.",
    caution: "WorkSafe premiums carry GST; check the notice before claiming it.",
  },
];

const chart = ACCOUNTS.map(([code, name, type, taxCode, treatment]) => ({
  code,
  name,
  type,
  taxCode,
  description: "",
  entity: company.name,
  gstTreatment: treatment,
  entityKind: company.kind,
}));

// Invoices still unpaid at the end of the year, with GST in them.
const invoices = [
  ["INV-1184", "Bellarine Homes", "2026-06-12", "2026-07-12", 9020, "Rough-in, lot 14 Clifton Springs"],
  ["INV-1187", "Corio Property Management", "2026-06-26", "2026-07-10", 1386, "Burst pipe call-out, 3 Bay Street"],
].map(([number, contact, issued, due, dollars, words]) => {
  const gross = cents(dollars);
  const tax = Math.round(gross / 11);
  return {
    number,
    kind: "sales",
    contact,
    reference: "",
    issued,
    due,
    total: gross,
    tax,
    paid: 0,
    outstanding: gross,
    currency: "AUD",
    status: "Awaiting Payment",
    lines: [{ description: words, accountCode: "200", taxType: "GST on Income", net: gross - tax, tax, gross }],
  };
});

const contact = (name, kind, extra = {}) => ({ id: `c-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name, kind, ...extra });
const contacts = [
  contact("Bellarine Homes", "customer", { email: "accounts@bellarinehomes.example", terms: "30 days", address: "8 Moorabool Street\nGeelong VIC 3220" }),
  contact("Corio Property Management", "customer", { email: "maintenance@coriopm.example", terms: "14 days" }),
  contact("Barwon Heads Bakery", "customer", { email: "hello@bhbakery.example", terms: "7 days" }),
  contact("Ocean Grove Dental", "customer", { email: "admin@oceangrovedental.example", terms: "14 days" }),
  contact("Reece Plumbing", "vendor", { email: "geelong@reece.example", terms: "30 days EOM" }),
  contact("Tradelink", "vendor", { terms: "30 days EOM" }),
  contact("Geelong Trade Units", "vendor", { email: "leasing@geelongtradeunits.example" }),
  contact("Barwon Accountants", "vendor", { email: "team@barwonaccountants.example", terms: "Due on receipt" }),
];

const ledger = {
  version: 1,
  jurisdiction: "au",
  legitimateDuplicates: [],
  transactions,
  overrides,
  splits: {},
  invoiceMatches: {},
  transfers: {},
  entities: {
    entities: [
      {
        ...company,
        gstNumber: "37 615 284 903",
        address: "Unit 3, 41 Bell Park Road\nNorth Geelong VIC 3215",
        payTo: "BSB 063-000, account 9876 5432",
      },
    ],
    accounts: Object.fromEntries(ACCOUNTS.map(([code]) => [code, company.id])),
    banks: { [BUSINESS]: [company.id] },
  },
  chart,
  openingBalances: { asAt: FROM, source: "Last year's financial statements", accounts: opening },
  assets: [
    {
      number: "FA-0001",
      name: "Drain inspection camera",
      type: "Plant & Equipment",
      status: "Registered",
      purchased: day(9, 15),
      depreciationFrom: day(9, 15),
      cost: cents(8000),
      // Diminishing value over an effective life of five years: 200% / 5.
      rate: 40,
      method: "Diminishing Value",
      averaging: "Full Month",
      disposed: null,
    },
  ],
  invoices,
  contacts,
  exampleAiSuggestions,
  auPayroll: { employees, payRuns },
  modules: {},
  taxExtras: [],
  singleEntityConfirmed: true,
  aiEnabled: true,
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "ledger.json"), `${JSON.stringify(ledger, null, 1)}\n`);
const uncoded = transactions.length - Object.keys(overrides).length;
console.log(`au-company: ${transactions.length} lines (${uncoded} left uncoded), ${payRuns.length} pay runs; closes at ${(running / 100).toFixed(2)}`);
