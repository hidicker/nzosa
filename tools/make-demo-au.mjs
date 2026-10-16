/**
 * Invented Australian books for the online demo: a photographer registered
 * for GST (a sole trader, so the BAS, PAYG instalments and the small business
 * offset all show) and a residential rental (input taxed: no GST either way),
 * kept in one set of books for the year to 30 June 2026.
 *
 * One `ledger.json` in apps/web/public/demo/au/, in the shape the other demo
 * sets ship. Every name, number and figure is invented.
 *
 * Built to add up: opening balances balance, each BAS paid is the GST the
 * quarter's lines carry, and the script refuses to write a set whose bank
 * account would go overdrawn.
 *
 * Run: node tools/make-demo-au.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auPayLine, earnedBeforePay, superDueDate } from "../packages/core/dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "apps/web/public/demo/au");

const FROM = "2025-07-01";
const TO = "2026-06-30";

const studio = { id: "studio", name: "Wattle & Lens Photography", kind: "business", structure: "sole-trader", owners: [{ name: "Mia Chen", percent: 100 }], gstRegistered: true };
const rental = { id: "banksia", name: "7 Banksia Street, Newcastle", kind: "residential", owners: [{ name: "Mia Chen", percent: 100 }], gstRegistered: false };

// The Australian starter chart's codes and names, with the rental's own.
// [code, name, type, entity, tax code, treatment]
const ACCOUNTS = [
  ["200", "Sales", "Revenue", studio, "GST on Income", "standard"],
  ["270", "Interest Income", "Revenue", studio, "Input Taxed", "exempt"],
  ["404", "Bank Fees", "Expense", studio, "GST Free Expenses", "exempt"],
  ["412", "Consulting & Accounting", "Expense", studio, "GST on Expenses", "standard"],
  ["433", "Insurance", "Expense", studio, "GST on Expenses", "standard"],
  ["449", "Motor Vehicle Expenses", "Expense", studio, "GST on Expenses", "standard"],
  ["461", "Printing & Stationery", "Expense", studio, "GST on Expenses", "standard"],
  ["469", "Rent", "Expense", studio, "GST on Expenses", "standard"],
  ["473", "Repairs and Maintenance", "Expense", studio, "GST on Expenses", "standard"],
  ["485", "Subscriptions", "Expense", studio, "GST on Expenses", "standard"],
  ["489", "Telephone & Internet", "Expense", studio, "GST on Expenses", "standard"],
  ["493", "Travel - National", "Expense", studio, "GST on Expenses", "standard"],
  ["275", "Rent received", "Revenue", rental, "Input Taxed", "exempt"],
  ["551", "Council rates", "Expense", rental, "GST Free Expenses", "exempt"],
  ["552", "Water charges", "Expense", rental, "GST Free Expenses", "exempt"],
  ["553", "Property agent fees", "Expense", rental, "BAS Excluded", "exempt"],
  ["554", "Interest on loans", "Expense", rental, "GST Free Expenses", "exempt"],
  ["555", "Landlord insurance", "Expense", rental, "BAS Excluded", "exempt"],
  ["556", "Repairs and maintenance (rental)", "Expense", rental, "BAS Excluded", "exempt"],
  ["477", "Wages and Salaries", "Expense", studio, "BAS Excluded", "out-of-scope"],
  ["478", "Superannuation", "Expense", studio, "BAS Excluded", "out-of-scope"],
  ["804", "Wages Payable", "Current Liability", studio, "BAS Excluded", "out-of-scope"],
  ["825", "PAYG Withholdings Payable", "Current Liability", studio, "BAS Excluded", "out-of-scope"],
  ["826", "Superannuation Payable", "Current Liability", studio, "BAS Excluded", "out-of-scope"],
  ["610", "Accounts Receivable", "Accounts Receivable", studio, "BAS Excluded", "out-of-scope"],
  ["800", "Accounts Payable", "Accounts Payable", studio, "BAS Excluded", "out-of-scope"],
  ["820", "GST", "Current Liability", studio, "BAS Excluded", "exempt"],
  ["880", "Owner A Drawings", "Equity", studio, "BAS Excluded", "exempt"],
  ["960", "Retained Earnings", "Equity", studio, "BAS Excluded", "exempt"],
];
const account = new Map(ACCOUNTS.map(([code, name, type, entity, taxCode, treatment]) => [code, { code, name, type, entity, taxCode, treatment }]));

const BUSINESS = "au-business";
const RENTAL = "au-rental";
const BANKS = new Map([
  [BUSINESS, { label: "Business Transaction ••3302", entity: studio.id }],
  [RENTAL, { label: "Rental Account ••8817", entity: rental.id }],
]);

const lines = [];
const line = (bank, date, amount, payee, code, note) => {
  if (date < FROM || date > TO) throw new Error(`${date} is outside the period`);
  if (code !== undefined && !account.has(code)) throw new Error(`no account ${code}`);
  lines.push({ bank, date, amount, payee, code, note: note ?? "" });
};
// July to June: months 7-12 are 2025, 1-6 are 2026.
const day = (m, d) => `${m >= 7 ? 2025 : 2026}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const cents = (dollars) => Math.round(dollars * 100);
const MONTHS = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];

// --- the photography business --------------------------------------------------
const jobs = [
  [7, 11, 2860, "Riverbend Weddings"],
  [7, 25, 1540, "Paddington Real Estate"],
  [8, 8, 3300, "Riverbend Weddings"],
  [8, 22, 990, "Lune Cafe"],
  [9, 5, 2420, "Southbank Arts Festival"],
  [9, 19, 1760, "Paddington Real Estate"],
  [10, 10, 4180, "Riverbend Weddings"],
  [10, 24, 1210, "Kurrajong Physio"],
  [11, 7, 3740, "Riverbend Weddings"],
  [11, 21, 1650, "Paddington Real Estate"],
  [12, 5, 2200, "Lune Cafe"],
  [12, 12, 5280, "Riverbend Weddings"],
  [1, 16, 1430, "Kurrajong Physio"],
  [2, 6, 3960, "Riverbend Weddings"],
  [2, 20, 1870, "Paddington Real Estate"],
  [3, 6, 2750, "Southbank Arts Festival"],
  [3, 20, 4400, "Riverbend Weddings"],
  [4, 10, 1320, "Lune Cafe"],
  [4, 24, 2090, "Paddington Real Estate"],
  [5, 8, 3520, "Riverbend Weddings"],
  [5, 22, 1100, "Kurrajong Physio"],
  [6, 12, 2640, "Riverbend Weddings"],
];
// Each job's fee, GST in: a round figure, so a tenth of it is the GST in an eleventh.
for (const [m, d, amount, who] of jobs) line(BUSINESS, day(m, d), cents(Math.round((amount * 1.6) / 11) * 11), who, "200", "Photography, incl GST");

for (const m of MONTHS) {
  line(BUSINESS, day(m, 2), -cents(1320), "West End Studios", "469", "Studio rent, incl GST");
  line(BUSINESS, day(m, 4), -cents(84.99), "Adobe Systems", "485", "Creative Cloud, incl GST");
  line(BUSINESS, day(m, 9), -cents(89), "Telstra", "489", "Mobile and internet, incl GST");
  line(BUSINESS, day(m, 27), -cents(10), "Monthly account fee", "404", "Bank fee");
  line(BUSINESS, day(m, 28), -cents(2500), "Transfer to Mia Chen", "880", "Owner drawings");
}
line(BUSINESS, day(7, 15), -cents(1188), "AAMI Business Insurance", "433", "Equipment insurance, incl GST");
line(BUSINESS, day(8, 13), -cents(462), "Camera House", "473", "Lens service, incl GST");
line(BUSINESS, day(10, 3), -cents(286.4), "Officeworks", "461", "Prints and album boxes, incl GST");
line(BUSINESS, day(3, 12), -cents(198.6), "Officeworks", "461", "Printing, incl GST");
line(BUSINESS, day(9, 26), -cents(612), "Virgin Australia", "493", "Flight, Sydney wedding, incl GST");
line(BUSINESS, day(2, 18), -cents(880), "Bennett & Co Accountants", "412", "Tax return and BAS help, incl GST");
for (const [m, d, amount] of [[7, 19, 78.4], [9, 2, 81.15], [11, 14, 74.9], [1, 22, 79.6], [3, 27, 83.3], [5, 15, 76.55]]) {
  line(BUSINESS, day(m, d), -cents(amount), "Ampol", "449", "Fuel, incl GST");
}
line(BUSINESS, day(12, 31), cents(18.4), "Interest", "270", "Savings interest");
line(BUSINESS, day(6, 30), cents(21.75), "Interest", "270", "Savings interest");
// Left for the demonstration: lines nobody has coded yet.
line(BUSINESS, day(6, 3), -cents(149), "Canva Pty Ltd", undefined);
line(BUSINESS, day(6, 11), -cents(56.7), "Bunnings Warehouse", undefined);
line(BUSINESS, day(6, 18), -cents(38.5), "Australia Post", undefined);
line(BUSINESS, day(6, 24), cents(450), "Osko payment from J Patel", undefined);

// --- the rental ------------------------------------------------------------------
for (const m of MONTHS) {
  line(RENTAL, day(m, 1), cents(2340), "Hunter Property Group", "275", "Rent for the month, by the agent");
  line(RENTAL, day(m, 3), -cents(187.2), "Hunter Property Group", "553", "Management fee, 8% incl GST");
  line(RENTAL, day(m, 15), -cents(1415.5), "Westpac Home Loan", "554", "Loan interest");
}
line(RENTAL, day(8, 20), -cents(512.4), "City of Newcastle", "551", "Council rates, first instalment");
line(RENTAL, day(11, 20), -cents(512.4), "City of Newcastle", "551", "Council rates, second instalment");
line(RENTAL, day(2, 20), -cents(512.4), "City of Newcastle", "551", "Council rates, third instalment");
line(RENTAL, day(5, 20), -cents(512.4), "City of Newcastle", "551", "Council rates, fourth instalment");
for (const m of [9, 12, 3, 6]) line(RENTAL, day(m, 12), -cents(168.3), "Hunter Water", "552", "Water service charge");
line(RENTAL, day(10, 1), -cents(1640), "Allianz Landlord Insurance", "555", "Annual premium");
line(RENTAL, day(1, 28), -cents(385), "Coastal Plumbing", "556", "Hot water system repair");
line(RENTAL, day(6, 22), -cents(220), "Newcastle Garden Care", undefined);

// --- a part-time studio assistant, paid monthly ---------------------------------------------
const assistant = {
  id: "emp-sam",
  name: "Sam Okafor",
  taxFreeThreshold: true,
  tfnProvided: true,
  superFund: "Australian Retirement Trust",
  payFrequency: "monthly",
  usualGross: cents(2600),
};
const payRuns = [];
for (const m of MONTHS) {
  const end = new Date(Date.UTC(m >= 7 ? 2025 : 2026, m, 0)).toISOString().slice(0, 10);
  const payDate = end;
  const pay = auPayLine(assistant, assistant.usualGross, payDate, earnedBeforePay(payRuns, assistant.id, payDate));
  payRuns.push({ id: `run-${end}`, payDate, periodStart: `${end.slice(0, 8)}01`, periodEnd: end, lines: [pay] });
  line(BUSINESS, payDate, -pay.net, "Sam Okafor", "804", "Net pay");
}

// --- each BAS: the GST the quarter's lines carry, paid when due -----------------
// Worked as the BAS works it here: one eleventh of each side's total, not of each line.
const quarters = [
  { from: "2025-07-01", to: "2025-09-30", paid: "2025-10-28" },
  { from: "2025-10-01", to: "2025-12-31", paid: "2026-02-27" },
  { from: "2026-01-01", to: "2026-03-31", paid: "2026-04-28" },
];
for (const q of quarters) {
  let sales = 0;
  let purchases = 0;
  for (const one of lines) {
    if (one.bank !== BUSINESS || one.code === undefined || one.date < q.from || one.date > q.to) continue;
    if (account.get(one.code).treatment !== "standard") continue;
    if (one.amount > 0) sales += one.amount;
    else purchases -= one.amount;
  }
  const net = Math.round(sales / 11) - Math.round(purchases / 11);
  if (net > 0) line(BUSINESS, q.paid, -net, "ATO", "820", `BAS ${q.from.slice(0, 7)} to ${q.to.slice(0, 7)}, GST`);
  const withheld = payRuns.filter((r) => r.payDate >= q.from && r.payDate <= q.to).reduce((sum, r) => sum + r.lines[0].payg, 0);
  if (withheld > 0) line(BUSINESS, q.paid, -withheld, "ATO", "825", `BAS ${q.from.slice(0, 7)} to ${q.to.slice(0, 7)}, PAYG withheld`);
}
// Super for each quarter, paid to the fund by its due date (before payday super).
for (const q of [...quarters, { from: "2026-04-01", to: "2026-06-30" }]) {
  const owed = payRuns.filter((r) => r.payDate >= q.from && r.payDate <= q.to).reduce((sum, r) => sum + r.lines[0].superGuarantee, 0);
  const due = superDueDate(q.to);
  if (owed > 0 && due <= TO) line(BUSINESS, due, -owed, "Australian Retirement Trust", "826", "Super guarantee, Sam Okafor");
}
// PAYG instalments the ATO notified: the owner's income tax paid ahead, so drawings.
for (const paid of ["2025-10-28", "2026-02-27", "2026-04-28"]) line(BUSINESS, paid, -cents(1240), "ATO", "880", "PAYG instalment");

// --- put it together -----------------------------------------------------------
const opening = { [BUSINESS]: cents(22800), [RENTAL]: cents(5200), "960": -cents(28000) };
if (Object.values(opening).reduce((s, v) => s + v, 0) !== 0) throw new Error("opening balances do not balance");

const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.bank.localeCompare(b.bank) || b.amount - a.amount);
const running = new Map([[BUSINESS, opening[BUSINESS]], [RENTAL, opening[RENTAL]]]);
const transactions = [];
const overrides = {};
sorted.forEach((one, i) => {
  const id = `au-${String(i + 1).padStart(4, "0")}`;
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
    source: { importer: "invented", file: "au-demo.csv", line: i + 1 },
  });
  const balance = (running.get(one.bank) ?? 0) + one.amount;
  running.set(one.bank, balance);
  if (balance < 0) throw new Error(`${one.bank} goes overdrawn on ${one.date}`);
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
    id: idOf("Canva Pty Ltd"),
    code: "485",
    confidence: 0.9,
    because: "Canva is design software paid from the business account: a subscription, with GST in it from an Australian supplier.",
  },
  {
    id: idOf("Newcastle Garden Care"),
    code: "556",
    confidence: 0.88,
    because: "Garden care paid from the rental's account: upkeep of the rental property.",
    caution: "A residential rental makes input-taxed supplies, so no GST credit is claimed on it.",
  },
  {
    id: idOf("Osko payment from J Patel"),
    code: "200",
    confidence: 0.45,
    because: "Money in to the business account by Osko, most likely a client paying for a shoot.",
    caution: "Only a sale if a client paid it. A personal payment is not, and a sale's GST (one eleventh) is owed on it.",
  },
];

const chart = ACCOUNTS.map(([code, name, type, entity, taxCode, treatment]) => ({
  code,
  name,
  type,
  taxCode,
  description: "",
  entity: entity.name,
  gstTreatment: treatment,
  entityKind: entity.kind,
}));

// Invoices still unpaid at the end of the year, with GST in them.
const invoices = [
  ["INV-0231", "Southbank Arts Festival", "2026-05-29", "2026-06-12", 1980, "Festival programme photography"],
  ["INV-0232", "Kurrajong Physio", "2026-06-19", "2026-07-03", 880, "Staff portraits"],
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
    lines: [{ description: words, accountCode: "200", taxType: "15% GST on Income", net: gross - tax, tax, gross }],
  };
});

const contact = (name, kind, extra = {}) => ({ id: `c-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name, kind, ...extra });
const contacts = [
  contact("Riverbend Weddings", "customer", { email: "bookings@riverbendweddings.example", terms: "7 days", address: "41 Riverside Drive\nTeneriffe QLD 4005" }),
  contact("Paddington Real Estate", "customer", { email: "marketing@paddingtonre.example", terms: "14 days" }),
  contact("Lune Cafe", "customer", { email: "hello@lunecafe.example", terms: "7 days" }),
  contact("Southbank Arts Festival", "customer", { email: "accounts@southbankarts.example", terms: "14 days", address: "Grey Street\nSouth Brisbane QLD 4101" }),
  contact("Kurrajong Physio", "customer", { email: "admin@kurrajongphysio.example", terms: "14 days" }),
  contact("West End Studios", "vendor", { email: "leasing@westendstudios.example" }),
  contact("Bennett & Co Accountants", "vendor", { email: "team@bennettco.example", terms: "Due on receipt" }),
  contact("Hunter Property Group", "vendor", { phone: "02 4900 0000" }),
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
      { ...studio, gstNumber: "51 824 753 556", address: "Unit 4, 22 Boundary Street\nWest End QLD 4101", payTo: "BSB 064-000, account 1234 5678" },
      rental,
    ],
    accounts: Object.fromEntries(ACCOUNTS.map(([code, , , entity]) => [code, entity.id])),
    banks: { [BUSINESS]: [studio.id], [RENTAL]: [rental.id] },
  },
  chart,
  openingBalances: { asAt: FROM, source: "Last year's records", accounts: opening },
  assets: [],
  invoices,
  contacts,
  exampleAiSuggestions,
  auPayroll: { employees: [assistant], payRuns },
  modules: {},
  taxExtras: [],
  singleEntityConfirmed: false,
  aiEnabled: true,
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "ledger.json"), `${JSON.stringify(ledger, null, 1)}\n`);
const uncoded = transactions.length - Object.keys(overrides).length;
console.log(
  `au: ${transactions.length} lines (${uncoded} left uncoded); ` +
    [...running].map(([b, c]) => `${BANKS.get(b).label} closes at ${(c / 100).toFixed(2)}`).join("; "),
);
