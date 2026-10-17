/**
 * Invented United States company books for the online demo: a landscaping
 * business run as a C corporation in Oregon, with an officer and a crew lead
 * on semi-monthly payroll, for January to September 2026.
 *
 * Shows what the freelancer's books do not: a corporation paying its own
 * federal income tax (Form 1120, estimated payments during the year), payroll
 * from a payroll service posted as a journal each payday with the taxes
 * withheld and deposited (Form 941), and shareholders paid wages and a
 * dividend rather than taking draws. Oregon has no sales tax.
 *
 * One `ledger.json` in apps/web/public/demo/us-company/. Every name, number
 * and figure is invented.
 *
 * Built to add up: opening balances balance, each payday's journal balances,
 * and the script refuses to write a set whose bank account would go overdrawn.
 *
 * Run: node tools/make-demo-us-company.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "apps/web/public/demo/us-company");

const FROM = "2026-01-01";
const TO = "2026-09-30";

const company = {
  id: "landscaping",
  name: "Cedar Ridge Landscaping, Inc.",
  kind: "business",
  structure: "company",
  owners: [
    { name: "Dana Brooks", percent: 60 },
    { name: "Luis Ortega", percent: 40 },
  ],
  gstRegistered: false,
};

// [code, name, type]
const ACCOUNTS = [
  ["4000", "Landscaping services", "Revenue"],
  ["4900", "Interest income", "Revenue"],
  ["5000", "Plants and materials", "Direct Costs"],
  ["5100", "Subcontractors", "Direct Costs"],
  ["6000", "Advertising", "Expense"],
  ["6010", "Truck and equipment fuel", "Expense"],
  ["6020", "Equipment repairs", "Expense"],
  ["6050", "Insurance", "Expense"],
  ["6080", "Legal and professional services", "Expense"],
  ["6090", "Office expense", "Expense"],
  ["6095", "Software and subscriptions", "Expense"],
  ["6100", "Rent", "Expense"],
  ["6110", "Licenses and permits", "Expense"],
  ["6170", "Utilities", "Expense"],
  ["6180", "Bank charges", "Expense"],
  ["6300", "Wages and salaries", "Expense"],
  ["6310", "Payroll taxes", "Expense"],
  ["6320", "Payroll service fees", "Expense"],
  ["1100", "Accounts Receivable", "Accounts Receivable"],
  ["1500", "Equipment", "Fixed Asset"],
  ["2100", "Wages payable", "Current Liability"],
  ["2110", "Federal income tax withheld", "Current Liability"],
  ["2120", "Social Security payable", "Current Liability"],
  ["2130", "Medicare payable", "Current Liability"],
  ["2140", "Federal unemployment (FUTA) payable", "Current Liability"],
  ["2150", "Oregon withholding payable", "Current Liability"],
  ["2200", "Corporate income tax payable", "Current Liability"],
  ["3000", "Common stock", "Equity"],
  ["3200", "Dividends paid", "Equity"],
  ["3900", "Retained earnings", "Equity"],
];
const account = new Map(ACCOUNTS.map(([code, name, type]) => [code, { code, name, type }]));
const label = (code) => `${account.get(code).name} - ${code}`;

const BUSINESS = "usco-business";
const BANKS = new Map([[BUSINESS, { label: "Business Checking ••6290", entity: company.id }]]);

const lines = [];
const line = (date, amount, payee, code, note, split) => {
  if (date < FROM || date > TO) throw new Error(`${date} is outside the period`);
  if (code !== undefined && !account.has(code)) throw new Error(`no account ${code}`);
  lines.push({ bank: BUSINESS, date, amount, payee, code, note: note ?? "", split });
};
const month = (m, d) => `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const cents = (dollars) => Math.round(dollars * 100);
const lastDay = (m) => new Date(Date.UTC(2026, m, 0)).toISOString().slice(0, 10);

// --- the work: a slow winter, a busy spring and summer -----------------------------
const season = [0.45, 0.55, 0.9, 1.25, 1.4, 1.4, 1.3, 1.2, 1.05];
const clients = [
  ["Riverside HOA", 4, 9800, "Grounds maintenance"],
  ["Pearl District Lofts", 12, 4900, "Courtyard and planters"],
  ["Willamette Dental Group", 19, 2300, "Grounds maintenance"],
  ["Household jobs", 26, 7600, "Residential design and install"],
];
season.forEach((factor, i) => {
  const m = i + 1;
  for (const [who, d, base, words] of clients) {
    if (who === "Household jobs") {
      line(month(m, d), cents(Math.round(base * factor)), "Square deposit", "4000", words);
    } else {
      line(month(m, d), cents(Math.round(base * Math.max(0.7, factor))), who, "4000", words);
    }
  }
  line(month(m, 8), -cents(Math.round(2900 * factor)), "Portland Nursery Supply", "5000", "Plants, mulch and soil");
  line(month(m, 22), -cents(Math.round(950 * factor)), "Pacific Stone & Pavers", "5000", "Pavers and gravel");
  line(month(m, 1), -cents(1850), "Columbia Yard Rentals", "6100", "Yard and shop rent");
  line(month(m, 6), -cents(Math.round(420 * Math.max(0.6, factor))), "Chevron", "6010", "Truck and mower fuel");
  line(month(m, 10), -cents(59), "Jobber", "6095", "Scheduling and invoicing");
  line(month(m, 14), -cents(185), "Portland General Electric", "6170", "Shop power");
  line(month(m, 15), -cents(140), "Gusto", "6320", "Payroll service");
  line(month(m, 27), -cents(15), "Monthly service charge", "6180", "Bank charge");
});
line(month(5, 13), -cents(2200), "Green Thumb Irrigation", "5100", "Sprinkler install, subcontracted");
line(month(7, 21), -cents(1650), "Green Thumb Irrigation", "5100", "Drip system, subcontracted");
line(month(1, 20), -cents(3480), "Northwest Business Insurance", "6050", "General liability and auto, annual");
line(month(2, 17), -cents(275), "Oregon Landscape Contractors Board", "6110", "License renewal");
line(month(3, 9), -cents(1200), "Hill & Park CPA", "6080", "2025 Form 1120 and Oregon return");
line(month(3, 24), -cents(640), "Nextdoor Ads", "6000", "Spring advertising");
line(month(4, 7), -cents(918.4), "Pacific Small Engine", "6020", "Mower blades and service");
line(month(6, 30), -cents(486.75), "Pacific Small Engine", "6020", "Trimmer repair");
line(month(2, 25), -cents(162.3), "Staples", "6090", "Office supplies");
// A new commercial mower: equipment, not an expense.
line(month(3, 31), -cents(11800), "Pacific Small Engine", "1500", "Commercial zero-turn mower");
line(month(6, 30), cents(38.4), "Interest", "4900", "Savings interest");
// Left for the demonstration: lines nobody has coded yet.
line(month(9, 8), -cents(212.4), "Home Depot", undefined);
line(month(9, 14), -cents(89), "QuickBooks", undefined);
line(month(9, 17), cents(1250), "Zelle from M Chen", undefined);
line(month(9, 23), -cents(318), "Oregon DMV", undefined);

// --- payroll through Gusto, on the 15th and the last day of each month -------------
// Federal income tax withheld is the payroll service's figure for each, from the
// employee's W-4; Social Security 6.2% and Medicare 1.45% each side, FUTA 0.6%
// on the first $7,000 of each employee's wages; Oregon withholding.
const employees = [
  { name: "Dana Brooks", gross: 3500, fit: 412, oregon: 268 },
  { name: "Luis Ortega", gross: 2800, fit: 296, oregon: 205 },
];
const futaPaid = new Map();
const manualJournals = [];
const monthTaxes = new Map();
for (let m = 1; m <= 9; m += 1) {
  for (const payday of [month(m, 15), lastDay(m)]) {
    let gross = 0;
    let fit = 0;
    let ss = 0;
    let medicare = 0;
    let futa = 0;
    let oregon = 0;
    let employerTax = 0;
    for (const e of employees) {
      const g = cents(e.gross);
      const ssEach = Math.round(g * 0.062);
      const medEach = Math.round(g * 0.0145);
      const before = futaPaid.get(e.name) ?? 0;
      const futaWages = Math.max(0, Math.min(g, cents(7000) - before));
      futaPaid.set(e.name, before + g);
      const futaEach = Math.round(futaWages * 0.006);
      const net = g - cents(e.fit) - ssEach - medEach - cents(e.oregon);
      gross += g;
      fit += cents(e.fit);
      ss += 2 * ssEach;
      medicare += 2 * medEach;
      futa += futaEach;
      oregon += cents(e.oregon);
      employerTax += ssEach + medEach + futaEach;
      line(payday, -net, e.name, "2100", "Net pay");
    }
    const wagesNet = gross - fit - ss / 2 - medicare / 2 - oregon;
    const journal = {
      id: `payroll-${payday}`,
      date: payday,
      narration: `Payroll for the period ending ${payday}, from the Gusto payroll register`,
      source: "Gusto payroll register",
      lines: [
        { code: label("6300"), amount: gross, description: "Gross wages" },
        { code: label("6310"), amount: employerTax, description: "Employer Social Security, Medicare and FUTA" },
        { code: label("2110"), amount: -fit, description: "Federal income tax withheld" },
        { code: label("2120"), amount: -ss, description: "Social Security, employee and employer" },
        { code: label("2130"), amount: -medicare, description: "Medicare, employee and employer" },
        ...(futa > 0 ? [{ code: label("2140"), amount: -futa, description: "FUTA" }] : []),
        { code: label("2150"), amount: -oregon, description: "Oregon income tax withheld" },
        { code: label("2100"), amount: -wagesNet, description: "Net pay" },
      ],
    };
    if (journal.lines.reduce((s, l) => s + l.amount, 0) !== 0) throw new Error(`payroll ${payday} does not balance`);
    manualJournals.push(journal);
    const held = monthTaxes.get(m) ?? { fit: 0, ss: 0, medicare: 0, oregon: 0 };
    held.fit += fit;
    held.ss += ss;
    held.medicare += medicare;
    held.oregon += oregon;
    monthTaxes.set(m, held);
  }
}
// A monthly depositor: each month's 941 taxes by EFTPS on the 15th of the next,
// and Oregon's withholding the same day. September's are still owed at the end.
for (const [m, t] of monthTaxes) {
  if (m === 9) continue;
  const total = t.fit + t.ss + t.medicare;
  line(month(m + 1, 15), -total, "IRS EFTPS", undefined, `Form 941 deposit for ${month(m, 1).slice(0, 7)}`, [
    { amount: -t.fit, code: label("2110"), note: "Federal income tax withheld" },
    { amount: -t.ss, code: label("2120"), note: "Social Security" },
    { amount: -t.medicare, code: label("2130"), note: "Medicare" },
  ]);
  line(month(m + 1, 15), -t.oregon, "Oregon Department of Revenue", "2150", `Withholding for ${month(m, 1).slice(0, 7)}`);
}
// The corporation's own tax: last year's balance with the return, and this
// year's estimated payments.
line(month(4, 15), -cents(2140), "IRS", "2200", "2025 Form 1120 balance due");
line(month(4, 15), -cents(3000), "IRS", "2200", "2026 estimated tax, 1st");
line(month(6, 15), -cents(3000), "IRS", "2200", "2026 estimated tax, 2nd");
line(month(9, 15), -cents(3000), "IRS", "2200", "2026 estimated tax, 3rd");
// A dividend to the shareholders, in proportion to their stock.
line(month(7, 10), -cents(9000), "Dana Brooks", "3200", "Dividend");
line(month(7, 10), -cents(6000), "Luis Ortega", "3200", "Dividend");

// --- put it together -----------------------------------------------------------
const opening = { [BUSINESS]: cents(52500), "1500": cents(24000), "2200": -cents(2140), "3000": -cents(1000), "3900": -cents(73360) };
if (Object.values(opening).reduce((s, v) => s + v, 0) !== 0) throw new Error("opening balances do not balance");

const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
let running = opening[BUSINESS];
const transactions = [];
const overrides = {};
const splits = {};
sorted.forEach((one, i) => {
  const id = `usco-${String(i + 1).padStart(4, "0")}`;
  transactions.push({
    id,
    occurrence: 1,
    date: one.date,
    amount: one.amount,
    currency: "USD",
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
    source: { importer: "invented", file: "us-company-demo.csv", line: i + 1 },
  });
  running += one.amount;
  if (running < 0) throw new Error(`the account goes overdrawn on ${one.date}`);
  if (one.split !== undefined) {
    if (one.split.reduce((s, p) => s + p.amount, 0) !== one.amount) throw new Error(`split on ${one.date} does not add up`);
    splits[id] = one.split;
    // Split and confirmed, as the bookkeeper left it.
    overrides[id] = { confirmed: true, note: one.note, at: one.date };
  } else if (one.code !== undefined) {
    overrides[id] = { confirmed: true, code: label(one.code), note: one.note || account.get(one.code).name, at: one.date };
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
    id: idOf("Home Depot"),
    code: "5000",
    confidence: 0.74,
    because: "Hardware bought by a landscaping company: most likely materials for a job.",
    caution: "A tool kept for use is an expense or equipment, not a job's materials.",
  },
  {
    id: idOf("QuickBooks"),
    code: "6095",
    confidence: 0.9,
    because: "Accounting software paid monthly: a subscription.",
  },
  {
    id: idOf("Zelle from M Chen"),
    code: "4000",
    confidence: 0.55,
    because: "Money in by Zelle from a person: most likely a household paying for a job.",
    caution: "Match it to an invoice if one was sent. A shareholder putting money in is a loan or capital, not income.",
  },
  {
    id: idOf("Oregon DMV"),
    code: "6110",
    confidence: 0.8,
    because: "The DMV: registration for the company's truck or trailer.",
  },
];

const chart = ACCOUNTS.map(([code, name, type]) => ({
  code,
  name,
  type,
  taxCode: "Tax Exempt",
  description: "",
  entity: company.name,
  entityKind: company.kind,
}));

// Invoices still unpaid at the end of the period.
const invoices = [
  ["INV-2041", "Riverside HOA", "2026-08-31", "2026-09-30", 6820, "August grounds maintenance"],
  ["INV-2046", "Pearl District Lofts", "2026-09-15", "2026-10-15", 3720, "Fall planting, courtyard"],
].map(([number, contact, issued, due, dollars, words]) => ({
  number,
  kind: "sales",
  contact,
  reference: "",
  issued,
  due,
  total: cents(dollars),
  tax: 0,
  paid: 0,
  outstanding: cents(dollars),
  currency: "USD",
  status: "Awaiting Payment",
  lines: [{ description: words, accountCode: "4000", taxType: "No GST", net: cents(dollars), tax: 0, gross: cents(dollars) }],
}));

const contact = (name, kind, extra = {}) => ({ id: `c-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name, kind, ...extra });
const contacts = [
  contact("Riverside HOA", "customer", { email: "board@riversidehoa.example", terms: "Net 30", address: "1200 River Road\nPortland, OR 97219" }),
  contact("Pearl District Lofts", "customer", { email: "manager@pearllofts.example", terms: "Net 30" }),
  contact("Willamette Dental Group", "customer", { email: "office@willamettedental.example", terms: "Net 15" }),
  contact("Green Thumb Irrigation", "vendor", { email: "office@greenthumb.example", w9: true, is1099: true }),
  contact("Portland Nursery Supply", "vendor", { terms: "Net 30" }),
  contact("Hill & Park CPA", "vendor", { email: "team@hillparkcpa.example", terms: "Due on receipt" }),
];

const ledger = {
  version: 1,
  jurisdiction: "us",
  legitimateDuplicates: [],
  transactions,
  overrides,
  splits,
  invoiceMatches: {},
  transfers: {},
  entities: {
    entities: [{ ...company, address: "4410 SE Johnson Creek Blvd\nPortland, OR 97222" }],
    accounts: Object.fromEntries(ACCOUNTS.map(([code]) => [code, company.id])),
    banks: { [BUSINESS]: [company.id] },
  },
  chart,
  openingBalances: { asAt: FROM, source: "Last year's balance sheet", accounts: opening },
  assets: [],
  invoices,
  contacts,
  manualJournals,
  exampleAiSuggestions,
  modules: { classes: true, budgets: true },
  taxExtras: [],
  singleEntityConfirmed: true,
  aiEnabled: true,
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "ledger.json"), `${JSON.stringify(ledger, null, 1)}\n`);
const uncoded = transactions.length - Object.keys(overrides).length;
console.log(`us-company: ${transactions.length} lines (${uncoded} left uncoded), ${manualJournals.length} payroll journals; closes at ${(running / 100).toFixed(2)}`);
