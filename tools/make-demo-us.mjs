/**
 * Invented United States books for the online demo: a freelance design studio
 * (Schedule C) and a rented duplex (Schedule E) kept in one set of books, for
 * January to September 2026.
 *
 * One `ledger.json` in apps/web/public/demo/us/, in the shape the other demo
 * sets ship. The Tutorials page offers it once it is marked ready in
 * apps/web/src/demo-personas.ts. Every name, number and figure is invented.
 *
 * Built to add up: opening balances balance, and the script refuses to write
 * a set whose bank account would go overdrawn.
 *
 * Run: node tools/make-demo-us.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "apps/web/public/demo/us");

const FROM = "2026-01-01";
const TO = "2026-09-30";

const studio = { id: "studio", name: "Ellis Design Studio", kind: "business", structure: "sole-trader", owners: [{ name: "Jordan Ellis", percent: 100 }], gstRegistered: false };
const duplex = { id: "duplex", name: "48 Larch Court (duplex)", kind: "residential", owners: [{ name: "Jordan Ellis", percent: 100 }], gstRegistered: false };

// The starter chart's own codes and names, with a few more for this business.
const ACCOUNTS = [
  // [code, name, type, entity]
  ["4000", "Sales", "Revenue", studio],
  ["4100", "Rent received", "Revenue", duplex],
  ["6000", "Advertising", "Expense", studio],
  ["6010", "Car and truck expenses", "Expense", studio],
  ["6030", "Contract labor", "Expense", studio],
  ["6050", "Insurance", "Expense", studio],
  ["6055", "Landlord insurance", "Expense", duplex],
  ["6060", "Mortgage interest", "Expense", duplex],
  ["6080", "Legal and professional services", "Expense", studio],
  ["6090", "Office expense", "Expense", studio],
  ["6095", "Software and subscriptions", "Expense", studio],
  ["6120", "Repairs and maintenance", "Expense", duplex],
  ["6130", "Supplies", "Expense", studio],
  ["6140", "Property taxes", "Expense", duplex],
  ["6150", "Travel", "Expense", studio],
  ["6160", "Business meals", "Expense", studio],
  ["6170", "Utilities", "Expense", studio],
  ["6190", "Property management fees", "Expense", duplex],
  ["1100", "Accounts Receivable", "Accounts Receivable", studio],
  ["3100", "Owner draws", "Equity", studio],
  ["3900", "Retained earnings", "Equity", studio],
];
const account = new Map(ACCOUNTS.map(([code, name, type, entity]) => [code, { code, name, type, entity }]));

const BUSINESS = "us-business";
const RENTAL = "us-rental";
const BANKS = new Map([
  [BUSINESS, { label: "Business Checking ••4821", entity: studio.id }],
  [RENTAL, { label: "Rental Checking ••7733", entity: duplex.id }],
]);

const lines = [];
const line = (bank, date, amount, payee, code, note) => {
  if (date < FROM || date > TO) throw new Error(`${date} is outside the period`);
  if (code !== undefined && !account.has(code)) throw new Error(`no account ${code}`);
  lines.push({ bank, date, amount, payee, code, note: note ?? "" });
};
const month = (m, d) => `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const cents = (dollars) => Math.round(dollars * 100);

// --- the design studio ---------------------------------------------------------
const clients = [
  [1, 9, 4200, "Northwind Dental"],
  [1, 23, 2850, "Pioneer Coffee Co"],
  [2, 6, 5600, "Lakeside Realty"],
  [2, 20, 1800, "Pioneer Coffee Co"],
  [3, 4, 6400, "Northwind Dental"],
  [3, 18, 3200, "Greenfield Hardware"],
  [4, 8, 4750, "Lakeside Realty"],
  [4, 24, 2300, "Marlow & Finch LLP"],
  [5, 12, 5100, "Greenfield Hardware"],
  [5, 27, 3900, "Pioneer Coffee Co"],
  [6, 10, 6200, "Northwind Dental"],
  [6, 25, 2750, "Marlow & Finch LLP"],
  [7, 14, 4800, "Lakeside Realty"],
  [7, 29, 3350, "Harborview Clinic"],
  [8, 11, 5400, "Greenfield Hardware"],
  [8, 26, 2950, "Harborview Clinic"],
  [9, 8, 4300, "Northwind Dental"],
  [9, 22, 3600, "Pioneer Coffee Co"],
];
for (const [m, d, amount, who] of clients) line(BUSINESS, month(m, d), cents(amount), who, "4000", "Design fees");

for (let m = 1; m <= 9; m += 1) {
  line(BUSINESS, month(m, 5), -cents(54.99), "Figma subscription", "6095", "Design software");
  line(BUSINESS, month(m, 6), -cents(14.4), "Google Workspace", "6095", "Email and documents");
  line(BUSINESS, month(m, 14), -cents(79.0), "Metro Fiber internet", "6170", "Studio internet");
  line(BUSINESS, month(m, 28), -cents(3000), "Owner draw", "3100", "Owner draw");
}
// Contractors: two over the 1099-NEC threshold and one under it.
line(BUSINESS, month(2, 19), -cents(1100), "Priya Nair (illustration)", "6030", "Illustration work");
line(BUSINESS, month(4, 17), -cents(850), "Priya Nair (illustration)", "6030", "Illustration work");
line(BUSINESS, month(7, 9), -cents(900), "Priya Nair (illustration)", "6030", "Illustration work");
line(BUSINESS, month(3, 12), -cents(1800), "Marco Bellini (web development)", "6030", "Website build");
line(BUSINESS, month(6, 30), -cents(450), "Tess Whitfield (proofreading)", "6030", "Copy edit");
// The rest of the year's costs.
line(BUSINESS, month(1, 15), -cents(486), "Harbor Mutual (business insurance)", "6050", "Quarterly premium");
line(BUSINESS, month(4, 15), -cents(486), "Harbor Mutual (business insurance)", "6050", "Quarterly premium");
line(BUSINESS, month(7, 15), -cents(486), "Harbor Mutual (business insurance)", "6050", "Quarterly premium");
line(BUSINESS, month(2, 24), -cents(640), "Whitlock & Co CPA", "6080", "Bookkeeping and tax prep");
line(BUSINESS, month(6, 3), -cents(320), "Whitlock & Co CPA", "6080", "Quarterly advice");
line(BUSINESS, month(1, 21), -cents(212.4), "Staples", "6090", "Printer paper and toner");
line(BUSINESS, month(5, 16), -cents(96.35), "Staples", "6130", "Supplies");
line(BUSINESS, month(3, 26), -cents(180), "Lakeshore Print Co", "6130", "Portfolio prints");
line(BUSINESS, month(2, 10), -cents(350), "Local Business Journal", "6000", "Advertising");
line(BUSINESS, month(6, 18), -cents(500), "Meta ads", "6000", "Advertising");
line(BUSINESS, month(3, 6), -cents(46.8), "Birchwood Bistro", "6160", "Client lunch");
line(BUSINESS, month(5, 22), -cents(82.15), "Sorrento Kitchen", "6160", "Client dinner");
line(BUSINESS, month(8, 5), -cents(38.9), "Birchwood Bistro", "6160", "Client lunch");
line(BUSINESS, month(4, 29), -cents(384.2), "Delta Air Lines", "6150", "Flight to client visit");
line(BUSINESS, month(4, 30), -cents(412), "Lakeview Hotel", "6150", "Two nights, client visit");
line(BUSINESS, month(2, 3), -cents(61.3), "Shell", "6010", "Fuel");
line(BUSINESS, month(5, 9), -cents(58.74), "Shell", "6010", "Fuel");
line(BUSINESS, month(8, 18), -cents(66.02), "Shell", "6010", "Fuel");
// Left for the demonstration: lines nobody has coded yet.
line(BUSINESS, month(8, 20), -cents(129), "Adobe", undefined);
line(BUSINESS, month(9, 3), -cents(310), "Rivera Plumbing", undefined);
line(BUSINESS, month(9, 12), -cents(74.4), "USPS", undefined);
line(BUSINESS, month(9, 16), cents(250), "Venmo transfer", undefined);
line(BUSINESS, month(9, 19), -cents(48), "Zoom", undefined);
line(BUSINESS, month(9, 24), -cents(215), "Tony's Garage", undefined);

// --- the duplex ----------------------------------------------------------------
for (let m = 1; m <= 9; m += 1) {
  line(RENTAL, month(m, 1), cents(1850), "Okafor household", "4100", "Unit A rent");
  line(RENTAL, month(m, 3), cents(1700), "Reyes household", "4100", "Unit B rent");
  line(RENTAL, month(m, 15), -cents(612.5), "First Lakes Bank (mortgage interest)", "6060", "Mortgage interest");
  line(RENTAL, month(m, 4), -cents(284), "Buckeye Property Management", "6190", "Management fee, 8%");
}
line(RENTAL, month(2, 11), -cents(1420), "Midwest Mutual (landlord insurance)", "6055", "Annual premium");
line(RENTAL, month(4, 10), -cents(2100), "County treasurer", "6140", "Property tax, first half");
line(RENTAL, month(9, 10), -cents(2100), "County treasurer", "6140", "Property tax, second half");
line(RENTAL, month(3, 20), -cents(385.4), "Handy Pro Repairs", "6120", "Unit A water heater valve");
line(RENTAL, month(6, 12), -cents(940), "Greenleaf Landscaping", "6120", "Lawn and tree work");
line(RENTAL, month(8, 27), -cents(212.75), "Reyes Hardware", "6120", "Unit B door lock");
line(RENTAL, month(9, 17), -cents(165), "Clearwater Plumbing", undefined);

// --- put it together -----------------------------------------------------------
const opening = { [BUSINESS]: cents(14500), [RENTAL]: cents(4200), "3900": -cents(18700) };
if (Object.values(opening).reduce((s, v) => s + v, 0) !== 0) throw new Error("opening balances do not balance");

const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.bank.localeCompare(b.bank) || b.amount - a.amount);
const running = new Map([[BUSINESS, opening[BUSINESS]], [RENTAL, opening[RENTAL]]]);
const transactions = [];
const overrides = {};
sorted.forEach((one, i) => {
  const id = `us-${String(i + 1).padStart(4, "0")}`;
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
    source: { importer: "invented", file: "us-demo.csv", line: i + 1 },
  });
  const balance = (running.get(one.bank) ?? 0) + one.amount;
  running.set(one.bank, balance);
  if (balance < 0) throw new Error(`${one.bank} goes overdrawn on ${one.date}`);
  if (one.code !== undefined) {
    const a = account.get(one.code);
    overrides[id] = { confirmed: true, code: `${a.name} - ${a.code}`, note: one.note || a.name, at: one.date };
  }
});

const chart = ACCOUNTS.map(([code, name, type, entity]) => ({
  code,
  name,
  type,
  taxCode: "Tax Exempt",
  description: "",
  entity: entity.name,
  entityKind: entity.kind,
}));

// Invoices still unpaid at the end of the period: one well past due, one just
// past due, so the customer pages have a reminder and a late fee to show.
const invoices = [
  ["INV-0101", "Lakeside Realty", "2026-07-20", "2026-08-19", 1650, "Brochure and signage design"],
  ["INV-0102", "Harborview Clinic", "2026-09-10", "2026-10-10", 2400, "Patient forms redesign"],
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

// Who the books deal with. Invented, like everything else here.
const contact = (name, kind, extra = {}) => ({ id: `c-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name, kind, ...extra });
const contacts = [
  contact("Northwind Dental", "customer", { email: "office@northwind-dental.example", terms: "Net 30", address: "220 Elm Street\nMadison, WI 53703" }),
  contact("Pioneer Coffee Co", "customer", { email: "hello@pioneercoffee.example", terms: "Net 15" }),
  contact("Lakeside Realty", "customer", { email: "accounts@lakesiderealty.example", phone: "608-555-0142", terms: "Net 30", address: "15 Shore Drive\nMadison, WI 53704" }),
  contact("Greenfield Hardware", "customer", { email: "ap@greenfieldhw.example", terms: "Net 30" }),
  contact("Marlow & Finch LLP", "customer", { email: "billing@marlowfinch.example", terms: "Net 30" }),
  contact("Harborview Clinic", "customer", { email: "finance@harborview.example", terms: "Net 30", address: "9 Harbor Road\nMonona, WI 53716" }),
  contact("Priya Nair (illustration)", "vendor", { email: "priya@nair-illustration.example", w9: true, is1099: true }),
  contact("Marco Bellini (web development)", "vendor", { email: "marco@bellini.example", w9: true, is1099: true }),
  contact("Tess Whitfield (proofreading)", "vendor", { w9: true }),
  contact("Whitlock & Co CPA", "vendor", { email: "team@whitlockcpa.example", terms: "Due on receipt" }),
  contact("Buckeye Property Management", "vendor", { phone: "608-555-0188" }),
];

const ledger = {
  version: 1,
  jurisdiction: "us",
  legitimateDuplicates: [],
  transactions,
  overrides,
  splits: {},
  invoiceMatches: {},
  transfers: {},
  entities: {
    entities: [studio, duplex],
    accounts: Object.fromEntries(ACCOUNTS.map(([code, , , entity]) => [code, entity.id])),
    banks: { [BUSINESS]: [studio.id], [RENTAL]: [duplex.id] },
  },
  chart,
  openingBalances: { asAt: FROM, source: "Last year's records", accounts: opening },
  assets: [],
  invoices,
  contacts,
  taxExtras: [],
  singleEntityConfirmed: false,
  aiEnabled: true,
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "ledger.json"), `${JSON.stringify(ledger, null, 1)}\n`);
const uncoded = transactions.length - Object.keys(overrides).length;
console.log(
  `us: ${transactions.length} lines (${uncoded} left uncoded); ` +
    [...running].map(([b, c]) => `${BANKS.get(b).label} closes at ${(c / 100).toFixed(2)}`).join("; "),
);
