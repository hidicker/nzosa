/**
 * More invented books for the online demo, so a visitor can see the parts of
 * NZOSA the coffee roastery never shows: a society's grants, a trust's people
 * and its IR6, a person's own IR3.
 *
 * Each is one `ledger.json` -- the same shape the main demo ships -- in its
 * own folder under apps/web/public/demo/. The demo's "View the demo as"
 * chooser loads one of them in place of the roastery. Every name, number and
 * figure here is made up.
 *
 * Run: node tools/make-demo-personas.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "apps/web/public/demo");

/** A year of months from April, as [month, year] pairs. */
const MONTHS = [
  [4, 2025], [5, 2025], [6, 2025], [7, 2025], [8, 2025], [9, 2025],
  [10, 2025], [11, 2025], [12, 2025], [1, 2026], [2, 2026], [3, 2026],
];
const day = (m, y, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const everyMonth = (d, amount, payee, code, note) =>
  MONTHS.map(([m, y]) => ({ date: day(m, y, d), amount, payee, code, note }));

/**
 * One set of books from a compact description.
 *
 * `lines` are `{ date, amount, payee, code?, note?, particulars? }`; a line
 * with no `code` is left uncoded, which is the work a demonstration should
 * leave to be done.
 */
function ledger(spec) {
  const transactions = [];
  const overrides = {};
  let n = 0;
  const sorted = [...spec.lines].sort((a, b) => a.date.localeCompare(b.date));
  for (const line of sorted) {
    n += 1;
    const id = `${spec.slug}-${String(n).padStart(4, "0")}`;
    transactions.push({
      id,
      occurrence: 1,
      date: line.date,
      amount: line.amount,
      currency: "NZD",
      serial: "",
      trn: "",
      particulars: line.particulars ?? line.note ?? "",
      code: "",
      reference: line.reference ?? "",
      otherParty: line.payee,
      origin: "",
      type: line.amount < 0 ? "DB" : "CR",
      batch: "",
      otherPartyAccount: "",
      account: spec.bank,
      extras: { accountLabel: spec.bankLabel },
      source: { importer: "invented", file: `${spec.slug}.csv`, line: n },
    });
    if (line.code !== undefined) {
      const account = spec.chart.find((a) => a.code === line.code);
      if (account === undefined) throw new Error(`${spec.slug}: no account ${line.code}`);
      overrides[id] = {
        confirmed: true,
        code: `${account.name} - ${account.code}`,
        treatment: "exempt",
        side: line.amount < 0 ? "purchases" : "sales",
        ...(line.note ? { note: line.note } : {}),
        at: line.date,
      };
    }
  }

  const entity = spec.entity;
  const chart = spec.chart.map((a) => ({
    code: a.code,
    name: a.name,
    type: a.type,
    taxCode: "No GST",
    description: a.description ?? "",
    entity: entity.name,
    gstTreatment: "exempt",
    entityKind: entity.kind,
  }));

  return {
    transactions,
    json: {
      version: 1,
      legitimateDuplicates: [],
      transactions,
      overrides,
      splits: {},
      invoiceMatches: {},
      transfers: {},
      entities: {
        entities: [entity],
        accounts: Object.fromEntries(spec.chart.map((a) => [a.code, entity.id])),
        banks: { [spec.bank]: [entity.id] },
      },
      chart,
      assets: [],
      invoices: [],
      taxExtras: spec.taxExtras ?? [],
      ...(spec.ir3Details ? { ir3Details: spec.ir3Details } : {}),
      ...(spec.grants ? { grants: spec.grants } : {}),
      ...(spec.grantLinks ? { grantLinks: spec.grantLinks(transactions) } : {}),
      aiEnabled: true,
    },
  };
}

function write(name, built) {
  const folder = join(out, name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "ledger.json"), `${JSON.stringify(built.json, null, 1)}\n`);
  console.log(`${name}: ${built.transactions.length} lines`);
}

// --- An incorporated society: a sailing club -------------------------------
{
  const chart = [
    { code: "400HS", name: "Subscriptions", type: "Revenue", description: "Member subscriptions" },
    { code: "410HS", name: "Clubroom bar and canteen", type: "Revenue", description: "Takings from the bar and canteen" },
    { code: "420HS", name: "Grants", type: "Revenue", description: "Grants from funders" },
    { code: "430HS", name: "Donations", type: "Revenue", description: "Gifts from members and the public" },
    { code: "440HS", name: "Regatta entry fees", type: "Revenue", description: "Entry fees for the club regatta" },
    { code: "500HS", name: "Insurance", type: "Expense", description: "Boats, building and liability" },
    { code: "510HS", name: "Boat purchases and repairs", type: "Expense", description: "Training dinghies, rescue boat, repairs" },
    { code: "520HS", name: "Coaching", type: "Expense", description: "Coaches' fees" },
    { code: "530HS", name: "Clubroom rent and power", type: "Expense", description: "The harbour board lease and power" },
    { code: "540HS", name: "Bar and canteen stock", type: "Expense", description: "Stock for resale" },
    { code: "550HS", name: "Regatta costs", type: "Expense", description: "Prizes, marquee hire, safety boats" },
    { code: "560HS", name: "Affiliation fees", type: "Expense", description: "Yachting New Zealand" },
  ];
  const lines = [
    // Subscriptions arrive in two waves, season start and mid-season.
    ...[[4, 2025, 3], [4, 2025, 8], [5, 2025, 5], [5, 2025, 19], [9, 2025, 6], [10, 2025, 14]].map(([m, y, d], i) => ({
      date: day(m, y, d), amount: [48_000, 36_000, 24_000, 60_000, 30_000, 42_000][i],
      payee: ["Members subs batch", "Members subs batch", "Members subs batch", "Family memberships", "Members subs batch", "Late joiners"][i],
      code: "400HS", note: "Season subscriptions",
    })),
    ...everyMonth(2, 31_000, "Clubroom bar takings", "410HS", "Bar and canteen, banked weekly").map((l, i) => ({
      ...l, amount: 31_000 + (i % 4) * 4_500,
    })),
    { date: day(6, 2025, 18), amount: 600_000, payee: "Tasman Community Trust", code: "420HS", note: "Grant to replace two training dinghies", reference: "Grant 2025/114" },
    { date: day(11, 2025, 5), amount: 25_000, payee: "Nelson Rotary Club", code: "430HS", note: "Donation toward the youth programme" },
    { date: day(2, 2026, 21), amount: 8_000, payee: "A. Pennington", code: "430HS", note: "Donation" },
    ...[[1, 2026, 17, 7_500, "Entries, day one"], [1, 2026, 18, 9_000, "Entries, day two"]].map(([m, y, d, a, n]) => ({
      date: day(m, y, d), amount: a * 10, payee: "Regatta entries", code: "440HS", note: n,
    })),
    { date: day(5, 2025, 12), amount: -184_000, payee: "Marsden Marine Insurance", code: "500HS", note: "Annual cover, boats and clubroom" },
    { date: day(7, 2025, 24), amount: -318_500, payee: "Sunburst Sailboats Ltd", code: "510HS", note: "Two training dinghies, replaced from the grant" },
    { date: day(8, 2025, 9), amount: -64_200, payee: "Sunburst Sailboats Ltd", code: "510HS", note: "Sails and fittings for the new dinghies" },
    { date: day(10, 2025, 30), amount: -22_800, payee: "Port Nelson Marine Services", code: "510HS", note: "Rescue boat service" },
    ...everyMonth(10, -42_000, "Harbour Board lease", "530HS", "Clubroom ground lease"),
    ...everyMonth(22, -11_800, "Contact Energy", "530HS", "Power for the clubroom").map((l, i) => ({ ...l, amount: -9_000 - ((i * 7) % 5) * 1_300 })),
    ...[[6, 2025, 3], [9, 2025, 7], [12, 2025, 11]].map(([m, y, d], i) => ({
      date: day(m, y, d), amount: [-72_000, -72_000, -96_000][i], payee: "Coach Mel Turei", code: "520HS", note: "Learn-to-sail coaching block",
    })),
    ...[[5, 2025, 29], [8, 2025, 14], [11, 2025, 20], [2, 2026, 12]].map(([m, y, d], i) => ({
      date: day(m, y, d), amount: [-48_000, -52_500, -39_000, -61_000][i], payee: "Gilmour Beverages", code: "540HS", note: "Bar stock",
    })),
    { date: day(1, 2026, 12), amount: -86_500, payee: "Top Tent Hire", code: "550HS", note: "Marquee and tables for the regatta" },
    { date: day(1, 2026, 16), amount: -34_200, payee: "Regatta prizes", code: "550HS", note: "Trophies and prizes" },
    { date: day(6, 2025, 2), amount: -28_000, payee: "Yachting New Zealand", code: "560HS", note: "Club affiliation" },
    // Left for a person to do: the work a demonstration should show.
    { date: day(3, 2026, 4), amount: -14_600, payee: "Mitre 10 Nelson", note: "Paint and varnish" },
    { date: day(3, 2026, 11), amount: -9_500, payee: "Anchor Printing", note: "Regatta programmes" },
    { date: day(3, 2026, 19), amount: 12_000, payee: "B Hartley", note: "Sponsorship, regatta programme" },
  ];

  const entity = {
    id: "harbourside-sailing-club",
    name: "Harbourside Sailing Club Incorporated",
    note: "An incorporated society",
    about: "A volunteer-run sailing club: junior learn-to-sail, a clubroom bar, one regatta a year, and a grant to renew the training fleet.",
    kind: "nonprofit",
    gstRegistered: false,
    codeSuffix: "HS",
    owners: [],
    nonprofit: { form: "society" },
  };
  write(
    "society",
    ledger({
      slug: "society", bank: "03-0102-0345678-000", bankLabel: "Harbourside Sailing Club Cheque", chart, lines, entity,
      grants: [
        {
          id: "tct-2025-114",
          entityId: entity.id,
          funder: "Tasman Community Trust",
          purpose: "Replace two worn training dinghies and fit them out",
          amount: 600_000,
          from: "2025-06-01",
          to: "2026-05-31",
          conditions: "Spent on the training fleet. A short report and receipts are due after the money is spent.",
          conditional: true,
          reportDue: "2026-06-30",
        },
      ],
      grantLinks: (transactions) =>
        Object.fromEntries(
          transactions
            .filter((t) => t.otherParty === "Tasman Community Trust" || (t.otherParty === "Sunburst Sailboats Ltd"))
            .map((t) => [t.id, "tct-2025-114"]),
        ),
    }),
  );
}

// --- A family trust: one rental house and some savings -----------------------
{
  const chart = [
    { code: "200WT", name: "Rent received", type: "Revenue", description: "Rent from the tenant at 8 Totara Place" },
    { code: "260WT", name: "Interest received", type: "Revenue", description: "Term deposit and savings interest" },
    { code: "404WT", name: "Bank fees", type: "Expense", description: "Account fees" },
    { code: "416WT", name: "Accounting fees", type: "Expense", description: "Annual accounts and returns" },
    { code: "433WT", name: "Insurance", type: "Expense", description: "House insurance" },
    { code: "437WT", name: "Mortgage interest", type: "Expense", description: "Interest on the loan against the house" },
    { code: "469WT", name: "Rates", type: "Expense", description: "Council and water rates" },
    { code: "473WT", name: "Repairs and maintenance", type: "Expense", description: "Repairs to the house" },
    { code: "490WT", name: "Property management", type: "Expense", description: "Agent's fees" },
  ];
  const lines = [
    ...everyMonth(1, 280_000, "Rent - 8 Totara Place", "200WT", "Weekly rent, banked monthly by the agent"),
    ...everyMonth(3, -22_400, "Harcourt Property Management", "490WT", "Management fee"),
    ...everyMonth(15, -118_000, "Westpac mortgage interest", "437WT", "Interest on the loan"),
    { date: day(5, 2025, 14), amount: -168_200, payee: "Tower Insurance", code: "433WT", note: "House insurance, annual" },
    { date: day(8, 2025, 26), amount: -94_300, payee: "Nelson City Council", code: "469WT", note: "Rates, instalment 1" },
    { date: day(11, 2025, 25), amount: -94_300, payee: "Nelson City Council", code: "469WT", note: "Rates, instalment 2" },
    { date: day(2, 2026, 24), amount: -94_300, payee: "Nelson City Council", code: "469WT", note: "Rates, instalment 3" },
    { date: day(5, 2025, 30), amount: -94_300, payee: "Nelson City Council", code: "469WT", note: "Rates, instalment 4" },
    { date: day(7, 2025, 8), amount: -41_200, payee: "Tasman Plumbing", code: "473WT", note: "Hot water cylinder valve" },
    { date: day(10, 2025, 21), amount: -28_800, payee: "Glen's Gardens", code: "473WT", note: "Section tidy" },
    { date: day(6, 2025, 27), amount: 142_500, payee: "Kiwibank interest", code: "260WT", note: "Term deposit interest" },
    { date: day(12, 2025, 15), amount: 126_800, payee: "Kiwibank interest", code: "260WT", note: "Term deposit interest" },
    { date: day(6, 2025, 20), amount: -149_500, payee: "Nelson Tax & Accounting", code: "416WT", note: "Accounts and returns, last year" },
    { date: day(4, 2025, 30), amount: -1_000, payee: "Westpac", code: "404WT", note: "Account fee" },
    // Left for a person to do.
    { date: day(3, 2026, 6), amount: -36_700, payee: "Bunnings Nelson", note: "Fencing and paint" },
    { date: day(3, 2026, 18), amount: 500_000, payee: "Whitcombe, J", note: "Settlement of loan to trust" },
  ];

  const entity = {
    id: "whitcombe-family-trust",
    name: "Whitcombe Family Trust",
    note: "A complying trust",
    about: "A family trust that owns one rental house, and a term deposit. The trustees are the Whitcombes and an independent accountant.",
    kind: "trust",
    gstRegistered: false,
    codeSuffix: "WT",
    owners: [],
    trust: {
      type: "complying",
      deed: "2014-06-12",
      registered: true,
      settlors: [{ id: "s1", name: "Joan Whitcombe" }],
      appointers: [{ id: "a1", name: "Joan Whitcombe", since: "2014-06-12" }],
      beneficiaries: [
        { id: "b1", name: "Ana Whitcombe", born: "1984-03-02", residence: "NZ" },
        { id: "b2", name: "Tom Whitcombe", born: "1982-09-19", residence: "NZ" },
        { id: "b3", name: "Maia Whitcombe", born: "2012-07-30", residence: "NZ" },
      ],
    },
  };
  write("trust", ledger({ slug: "trust", bank: "03-1356-0789012-000", bankLabel: "Whitcombe Family Trust", chart, lines, entity }));
}

// --- A person: a salary, interest and dividends, and their own IR3 ------------
{
  const chart = [
    { code: "200ST", name: "Salary and wages (net)", type: "Revenue", description: "Pay after PAYE" },
    { code: "260ST", name: "Interest received", type: "Revenue", description: "Savings interest, after RWT" },
    { code: "262ST", name: "Dividends", type: "Revenue", description: "Shares, after imputation and RWT" },
    { code: "420ST", name: "Donations", type: "Expense", description: "Gifts to registered charities" },
    { code: "430ST", name: "Medical", type: "Expense", description: "Doctor, dentist and pharmacy" },
    { code: "440ST", name: "Insurance", type: "Expense", description: "Life and health insurance" },
    { code: "450ST", name: "Power and internet", type: "Expense", description: "Household utilities" },
    { code: "460ST", name: "Rates and mortgage", type: "Expense", description: "Home rates and mortgage payments" },
    { code: "470ST", name: "Groceries", type: "Expense", description: "Food and household" },
  ];
  const lines = [
    ...everyMonth(24, 523_400, "Nelson Tasman Health", "200ST", "Salary, net of PAYE and KiwiSaver"),
    ...everyMonth(18, -204_000, "Westpac home loan", "460ST", "Mortgage payment"),
    ...everyMonth(7, -15_400, "Contact Energy", "450ST", "Power").map((l, i) => ({ ...l, amount: -11_000 - ((i * 5) % 6) * 1_700 })),
    ...everyMonth(9, -9_900, "One NZ", "450ST", "Internet and mobile"),
    ...everyMonth(1, -12_400, "AIA Insurance", "440ST", "Life and income cover"),
    ...everyMonth(12, -34_000, "Countdown Nelson", "470ST", "Groceries").map((l, i) => ({ ...l, amount: -30_000 - ((i * 11) % 7) * 2_400 })),
    { date: day(6, 2025, 30), amount: 18_900, payee: "ASB interest", code: "260ST", note: "Savings interest after RWT" },
    { date: day(12, 2025, 31), amount: 21_300, payee: "ASB interest", code: "260ST", note: "Savings interest after RWT" },
    { date: day(9, 2025, 19), amount: 41_700, payee: "Fisher Funds dividends", code: "262ST", note: "Dividend after imputation credits" },
    { date: day(3, 2026, 20), amount: 38_400, payee: "Fisher Funds dividends", code: "262ST", note: "Dividend after imputation credits" },
    { date: day(12, 2025, 5), amount: -10_000, payee: "Cancer Society", code: "420ST", note: "Donation" },
    { date: day(3, 2026, 2), amount: -15_000, payee: "Hospice Nelson", code: "420ST", note: "Donation" },
    { date: day(8, 2025, 14), amount: -9_500, payee: "Richmond Medical Centre", code: "430ST", note: "Doctor" },
    { date: day(11, 2025, 3), amount: -18_200, payee: "Nelson Dental", code: "430ST", note: "Dentist" },
    { date: day(7, 2025, 1), amount: -148_000, payee: "Nelson City Council", code: "460ST", note: "Rates" },
    // Left for a person to do.
    { date: day(3, 2026, 8), amount: -23_900, payee: "Briscoes Nelson", note: "Bedding" },
    { date: day(3, 2026, 14), amount: -7_800, payee: "Caltex Richmond", note: "Fuel" },
  ];

  const entity = {
    id: "sam-taylor",
    name: "Sam Taylor",
    note: "A person's own books",
    about: "A salaried health worker with savings interest and a small share portfolio. Needs the IR3 each year.",
    kind: "personal",
    gstRegistered: false,
    codeSuffix: "ST",
    owners: [{ name: "Sam Taylor", percent: 100 }],
  };
  write(
    "personal",
    ledger({
      slug: "personal", bank: "01-0102-0456789-000", bankLabel: "Sam Taylor Everyday", chart, lines, entity,
      taxExtras: [
        { owner: "Sam Taylor", year: 2026, category: "salary", payer: "Nelson Tasman Health", gross: 8_320_000, credits: 1_724_000 },
        { owner: "Sam Taylor", year: 2026, category: "interest", payer: "ASB", gross: 55_800, credits: 18_400 },
        { owner: "Sam Taylor", year: 2026, category: "dividends", payer: "Fisher Funds", gross: 111_000, credits: 30_900 },
      ],
      ir3Details: [{ owner: "Sam Taylor", year: 2026, provisionalTaxPaid: 0 }],
    }),
  );
}
