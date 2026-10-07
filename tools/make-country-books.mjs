/**
 * Invented books for each country NZOSA can keep, for walking the country
 * packs end to end: a US landlord with a side business, an Australian
 * landlord registered for GST through a small business, and a Korean sole
 * trader with a rental. Every name and number is made up.
 *
 *   node tools/make-country-books.mjs <ledgers folder>
 *
 * Writes us-books, au-books and kr-books into that folder as ledger folders
 * the app opens with --ledger.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const out = resolve(process.argv[2] ?? "ledgers-countries");

const part = (data) => `${JSON.stringify({ version: 1, data }, null, 1)}\n`;

/** One set of books from a compact description. */
function books(name, spec) {
  const folder = join(out, name);
  mkdirSync(folder, { recursive: true });
  const transactions = [];
  const overrides = {};
  let n = 0;
  for (const [date, amount, payee, code, account] of spec.lines) {
    n += 1;
    const id = `${name}-${String(n).padStart(4, "0")}`;
    transactions.push({
      id,
      date,
      amount,
      currency: spec.currency,
      serial: "",
      trn: "",
      particulars: payee,
      code: "",
      reference: "",
      otherParty: payee,
      origin: "",
      type: amount < 0 ? "DEBIT" : "CREDIT",
      batch: "",
      otherPartyAccount: "",
      account,
      occurrence: 1,
      extras: {},
      source: { importer: "invented", file: `${name}.csv`, line: n },
    });
    const chartLine = spec.chart.find((a) => a.code === code);
    overrides[id] = { confirmed: true, code: `${chartLine.name} - ${code}` };
  }
  // What the folder is called in the app, and that it is a set of books at all.
  writeFileSync(join(folder, "ledger.json"), `${JSON.stringify({ name: spec.title, created: "2026-01-01T00:00:00.000Z" }, null, 1)}
`);
  writeFileSync(join(folder, "chart.json"), part(spec.chart));
  writeFileSync(join(folder, "transactions.json"), part(transactions));
  writeFileSync(join(folder, "entities.json"), part(spec.entities));
  writeFileSync(
    join(folder, "decisions.json"),
    part({
      overrides,
      splits: {},
      invoiceMatches: {},
      creditNotes: {},
      transfers: {},
      legitimateDuplicates: [],
      removedDuplicates: [],
      rejectedTransfers: [],
      varianceNotes: [],
      varianceAccounts: [],
      taxExtras: [],
      jurisdiction: spec.jurisdiction,
      singleEntityConfirmed: true,
    }),
  );
  console.log(`${folder}: ${transactions.length} lines`);
}

/** Twelve monthly lines from a year's first month. */
const monthly = (year, firstMonth, day, amount, payee, code, account) =>
  Array.from({ length: 12 }, (_, i) => {
    const m = ((firstMonth - 1 + i) % 12) + 1;
    const y = year + Math.floor((firstMonth - 1 + i) / 12);
    return [`${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`, amount, payee, code, account];
  });

// --- United States: a rental in Ohio and a design business --------------------
books("us-books", {
  title: "Sam Rivera (US)",
  jurisdiction: "us",
  currency: "USD",
  chart: [
    { code: "200R", name: "Rent received", type: "Revenue", taxCode: "No GST" },
    { code: "437R", name: "Mortgage interest", type: "Expense", taxCode: "No GST" },
    { code: "433R", name: "Insurance", type: "Expense", taxCode: "No GST" },
    { code: "473R", name: "Repairs and maintenance", type: "Expense", taxCode: "No GST" },
    { code: "420R", name: "Property taxes", type: "Expense", taxCode: "No GST" },
    { code: "445R", name: "Property management fees", type: "Expense", taxCode: "No GST" },
    { code: "200B", name: "Design fees", type: "Revenue", taxCode: "No GST" },
    { code: "460B", name: "Contract labor", type: "Expense", taxCode: "No GST" },
    { code: "470B", name: "Software subscriptions", type: "Expense", taxCode: "No GST" },
    { code: "429B", name: "Business meals", type: "Expense", taxCode: "No GST" },
    { code: "449B", name: "Vehicle expenses", type: "Expense", taxCode: "No GST" },
    { code: "970", name: "Owner draws", type: "Equity", taxCode: "No GST" },
  ],
  entities: {
    entities: [
      { id: "maple", name: "12 Maple Ave", kind: "residential", owners: [{ name: "Sam Rivera", percent: 100 }], gstRegistered: false },
      { id: "studio", name: "Rivera Design", kind: "business", structure: "sole-trader", owners: [{ name: "Sam Rivera", percent: 100 }], gstRegistered: false },
    ],
    accounts: { "200R": "maple", "437R": "maple", "433R": "maple", "473R": "maple", "420R": "maple", "445R": "maple", "200B": "studio", "460B": "studio", "470B": "studio", "429B": "studio", "449B": "studio" },
    banks: { "us-checking": ["maple", "studio"] },
  },
  lines: [
    ...monthly(2026, 1, 1, 185_000, "Tenant J. Okafor", "200R", "us-checking"),
    ...monthly(2026, 1, 15, -61_250, "First Lakes Bank mortgage interest", "437R", "us-checking"),
    ...monthly(2026, 1, 3, -14_800, "Buckeye Property Mgmt", "445R", "us-checking"),
    ["2026-02-10", -142_000, "Midwest Mutual insurance", "433R", "us-checking"],
    ["2026-05-22", -38_540, "Handy Pro repairs", "473R", "us-checking"],
    ["2026-06-20", -210_000, "County treasurer property tax", "420R", "us-checking"],
    ["2026-12-20", -210_000, "County treasurer property tax", "420R", "us-checking"],
    ...monthly(2026, 1, 28, 640_000, "Client invoices", "200B", "us-checking"),
    ["2026-03-14", -125_000, "Ana Plumbing (contract)", "460B", "us-checking"],
    ["2026-08-02", -95_000, "Ana Plumbing (contract)", "460B", "us-checking"],
    ["2026-04-09", -80_000, "Bo Painting (contract)", "460B", "us-checking"],
    ...monthly(2026, 1, 5, -5_999, "Figma subscription", "470B", "us-checking"),
    ["2026-07-18", -18_600, "Client lunch", "429B", "us-checking"],
    ["2026-09-30", -9_420, "Gas station", "449B", "us-checking"],
    ["2026-10-15", -300_000, "Owner draw", "970", "us-checking"],
  ],
});

// --- Australia: a GST-registered café supplier and a rental -------------------
books("au-books", {
  title: "Mia Chen (AU)",
  jurisdiction: "au",
  currency: "AUD",
  chart: [
    { code: "200C", name: "Sales", type: "Revenue", taxCode: "GST on Income" },
    { code: "310C", name: "Cost of goods sold", type: "Direct Costs", taxCode: "GST on Expenses" },
    { code: "404C", name: "Bank fees", type: "Expense", taxCode: "No GST" },
    { code: "200R", name: "Rent received", type: "Revenue", taxCode: "Exempt Income" },
    { code: "437R", name: "Loan interest", type: "Expense", taxCode: "No GST" },
    { code: "420R", name: "Council rates", type: "Expense", taxCode: "No GST" },
    { code: "421R", name: "Water charges", type: "Expense", taxCode: "No GST" },
    { code: "422R", name: "Strata levies", type: "Expense", taxCode: "No GST" },
    { code: "445R", name: "Property agent fees", type: "Expense", taxCode: "No GST" },
    { code: "973", name: "Drawings", type: "Equity", taxCode: "No GST" },
    { code: "820", name: "GST", type: "Current Liability", taxCode: "No GST" },
  ],
  entities: {
    entities: [
      { id: "beans", name: "Bondi Beans", kind: "business", structure: "sole-trader", owners: [{ name: "Mia Chen", percent: 100 }], gstRegistered: true },
      { id: "unit", name: "4/22 Coogee St", kind: "residential", owners: [{ name: "Mia Chen", percent: 50 }, { name: "Leo Chen", percent: 50 }], gstRegistered: false },
    ],
    accounts: { "200C": "beans", "310C": "beans", "404C": "beans", "200R": "unit", "437R": "unit", "420R": "unit", "421R": "unit", "422R": "unit", "445R": "unit" },
    banks: { "au-business": ["beans"], "au-property": ["unit"] },
  },
  lines: [
    ...monthly(2025, 7, 20, 1_100_000, "Café customers", "200C", "au-business"),
    ...monthly(2025, 7, 22, -440_000, "Roastery wholesale", "310C", "au-business"),
    ...monthly(2025, 7, 30, -1_500, "Bank fee", "404C", "au-business"),
    ...monthly(2025, 7, 1, 260_000, "Tenant rent via agent", "200R", "au-property"),
    ...monthly(2025, 7, 15, -118_000, "Home loan interest", "437R", "au-property"),
    ...monthly(2025, 7, 2, -20_800, "Coastal Realty fees", "445R", "au-property"),
    ["2025-08-15", -62_000, "Council rates", "420R", "au-property"],
    ["2026-02-15", -62_000, "Council rates", "420R", "au-property"],
    ["2025-10-05", -24_500, "Sydney Water", "421R", "au-property"],
    ["2025-09-01", -95_000, "Strata levies", "422R", "au-property"],
    ["2026-03-01", -95_000, "Strata levies", "422R", "au-property"],
  ],
});

// --- South Korea: a small online shop and a rented officetel ------------------
books("kr-books", {
  title: "Kim Minji (KR)",
  jurisdiction: "kr",
  currency: "KRW",
  chart: [
    { code: "401", name: "매출 Sales", type: "Revenue", taxCode: "10% VAT on Income" },
    { code: "451", name: "매출원가 Cost of sales", type: "Direct Costs", taxCode: "10% VAT on Expenses" },
    { code: "811", name: "통신비 Communications", type: "Expense", taxCode: "10% VAT on Expenses" },
    { code: "813", name: "접대비 Entertainment", type: "Expense", taxCode: "No GST" },
    { code: "819", name: "지급임차료 Office rent", type: "Expense", taxCode: "10% VAT on Expenses" },
    { code: "411", name: "월세 수입 Rent received", type: "Revenue", taxCode: "10% VAT on Income" },
    { code: "817", name: "재산세 Property tax", type: "Expense", taxCode: "No GST" },
    { code: "931", name: "이자비용 Loan interest", type: "Expense", taxCode: "No GST" },
    { code: "820", name: "부가세예수금 VAT", type: "Current Liability", taxCode: "No GST" },
  ],
  entities: {
    entities: [
      { id: "shop", name: "한빛상회 Hanbit Shop", kind: "business", structure: "sole-trader", owners: [{ name: "Kim Minji", percent: 100 }], gstRegistered: true },
      { id: "officetel", name: "마포 오피스텔 Mapo officetel", kind: "commercial", owners: [{ name: "Kim Minji", percent: 100 }], gstRegistered: true },
    ],
    accounts: { "401": "shop", "451": "shop", "811": "shop", "813": "shop", "819": "shop", "411": "officetel", "817": "officetel", "931": "officetel" },
    banks: { "kr-shop": ["shop"], "kr-property": ["officetel"] },
  },
  lines: [
    // Won, held in hundredths: 3,300,000 won is 330,000,000.
    ...monthly(2026, 1, 25, 330_000_000, "스마트스토어 정산", "401", "kr-shop"),
    ...monthly(2026, 1, 10, -110_000_000, "도매 매입", "451", "kr-shop"),
    ...monthly(2026, 1, 20, -6_600_000, "KT 통신", "811", "kr-shop"),
    ...monthly(2026, 1, 1, -55_000_000, "사무실 월세", "819", "kr-shop"),
    ["2026-05-12", -45_000_000, "거래처 식사", "813", "kr-shop"],
    ...monthly(2026, 1, 5, 99_000_000, "오피스텔 월세", "411", "kr-property"),
    ...monthly(2026, 1, 21, -42_000_000, "대출 이자", "931", "kr-property"),
    ["2026-07-31", -38_000_000, "재산세", "817", "kr-property"],
    ["2026-09-30", -38_000_000, "재산세", "817", "kr-property"],
  ],
});
