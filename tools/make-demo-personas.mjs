/**
 * More invented books for the online demo, for the parts of NZOSA the coffee
 * roastery never shows: a society's grants, a trust and its IR6, a person's
 * own IR3 with a rental, and a business with staff on payroll.
 *
 * Each is one `ledger.json`, in its own folder under apps/web/public/demo/,
 * in the shape the main demo ships. The Tutorials page offers them once they
 * are marked ready in apps/web/src/demo-personas.ts.
 *
 * Built to add up. Every set starts from opening balances that balance, every
 * payment of GST, PAYE or tax is the amount actually owing, worked out here
 * the way the app works it out, and the script refuses to write a set whose
 * bank account would go overdrawn or whose opening balances do not balance.
 * Every name, number and figure is invented.
 *
 * Run: npm run build -w @nzosa/core && node tools/make-demo-personas.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPayRun, calculatePayLine, isValidIrdNumber, payrollJournal } from "../packages/core/dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "apps/web/public/demo");

const FY_START = "2025-04-01";
const FY_END = "2026-03-31";
const MONTHS = [
  [2025, 4], [2025, 5], [2025, 6], [2025, 7], [2025, 8], [2025, 9],
  [2025, 10], [2025, 11], [2025, 12], [2026, 1], [2026, 2], [2026, 3],
];
const day = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const addDays = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const dollars = (cents) => (cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The first valid IRD number at or after a seed, so every one shown is well formed. */
function ird(seed) {
  for (let n = seed; n < seed + 1000; n += 1) {
    const s = String(n).padStart(9, "0");
    if (isValidIrdNumber(s)) return `${s.slice(0, 3)}-${s.slice(3, 6)}-${s.slice(6)}`;
  }
  throw new Error(`no IRD number near ${seed}`);
}

/**
 * One set of books.
 *
 * Accounts are `[code, name, type, gst]`, with gst "s" for standard-rated,
 * "e" exempt and "o" outside the scope of GST. Lines with no code are left
 * uncoded: the work a demonstration should leave to be done.
 */
class Book {
  constructor({ slug, entities, accounts }) {
    this.slug = slug;
    this.entities = entities;
    this.accounts = new Map();
    this.chart = [];
    for (const [code, name, type, gst, entityId] of accounts) {
      const entity = entities.find((e) => e.id === (entityId ?? entities[0].id));
      if (entity === undefined) throw new Error(`${slug}: ${code} has no entity`);
      const income = /Revenue|Income/.test(type);
      const taxCode = gst === "s" ? (income ? "15% GST on Income" : "15% GST on Expenses") : "No GST";
      this.accounts.set(code, { code, name, type, gst, entity });
      this.chart.push({
        code, name, type, taxCode, description: "",
        entity: entity.name,
        gstTreatment: gst === "s" ? "standard" : gst === "e" ? "exempt" : "out-of-scope",
        entityKind: entity.kind,
      });
    }
    this.banks = new Map();
    this.lines = [];
    this.opening = {};
  }

  bank(number, label, entityId) {
    this.banks.set(number, { number, label, entityId: entityId ?? this.entities[0].id });
    return number;
  }

  open(key, cents) {
    if (cents !== 0) this.opening[key] = (this.opening[key] ?? 0) + cents;
  }

  /** A bank line, coded to an account unless `code` is omitted. */
  line(bank, date, amount, payee, code, note, extra = {}) {
    if (!this.banks.has(bank)) throw new Error(`${this.slug}: no bank ${bank}`);
    if (code !== undefined && !this.accounts.has(code)) throw new Error(`${this.slug}: no account ${code}`);
    if (date < FY_START || date > FY_END) throw new Error(`${this.slug}: ${date} is outside the year`);
    if (!Number.isInteger(amount) || amount === 0) throw new Error(`${this.slug}: bad amount ${amount} on ${date}`);
    this.lines.push({ bank, date, amount, payee, code, note, ...extra });
  }

  build(more = {}) {
    const sorted = [...this.lines].sort(
      (a, b) => a.date.localeCompare(b.date) || a.bank.localeCompare(b.bank) || b.amount - a.amount,
    );
    // Opening balances balance, or there is no point going on.
    const openingTotal = Object.values(this.opening).reduce((s, v) => s + v, 0);
    if (openingTotal !== 0) throw new Error(`${this.slug}: opening balances are out by ${dollars(openingTotal)}`);

    const transactions = [];
    const overrides = {};
    const running = new Map([...this.banks.keys()].map((b) => [b, this.opening[b] ?? 0]));
    const low = new Map();
    sorted.forEach((line, i) => {
      const id = `${this.slug}-${String(i + 1).padStart(4, "0")}`;
      const bank = this.banks.get(line.bank);
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
        account: line.bank,
        extras: { accountLabel: bank.label },
        source: { importer: "invented", file: `${this.slug}.csv`, line: i + 1 },
      });
      const balance = running.get(line.bank) + line.amount;
      running.set(line.bank, balance);
      if (balance < (low.get(line.bank)?.[0] ?? Infinity)) low.set(line.bank, [balance, line.date]);
      if (line.code !== undefined) {
        const account = this.accounts.get(line.code);
        const registered = account.entity.gstRegistered === true;
        overrides[id] = {
          confirmed: true,
          code: `${account.name} - ${account.code}`,
          treatment: !registered ? "exempt" : account.gst === "s" ? "standard" : account.gst === "e" ? "exempt" : "out-of-scope",
          side: line.amount < 0 ? "purchases" : "sales",
          note: line.note ?? account.name,
          at: line.date,
        };
      }
    });
    // Example AI answers, on the lines they were written for.
    const exampleAiSuggestions = sorted.flatMap((line, i) =>
      line.example === undefined ? [] : [{ id: transactions[i].id, ...line.example }]);
    for (const [bank, [least, when]] of low) {
      if (least < 0 && process.env.DEMO_TOTALS !== this.slug) throw new Error(`${this.slug}: ${bank} goes overdrawn, to ${dollars(least)} on ${when}`);
    }
    // Where the money went, by account, for checking a set reads like a real year.
    if (process.env.DEMO_TOTALS === this.slug) {
      const totals = new Map();
      for (const line of sorted) totals.set(line.code ?? "(uncoded)", (totals.get(line.code ?? "(uncoded)") ?? 0) + line.amount);
      for (const [code, cents] of [...totals].sort()) console.log(`  ${code.padEnd(10)} ${this.accounts.get(code)?.name ?? ""}`.padEnd(60) + dollars(cents).padStart(14));
    }

    const byEntity = {};
    for (const [bank, info] of this.banks) byEntity[bank] = [info.entityId];

    const summary = [...running].map(([bank, cents]) => `${this.banks.get(bank).label} closes at ${dollars(cents)}`);
    return {
      transactions,
      summary,
      closing: Object.fromEntries(running),
      json: {
        version: 1,
        legitimateDuplicates: [],
        transactions,
        overrides,
        splits: {},
        invoiceMatches: {},
        transfers: {},
        entities: {
          entities: this.entities,
          accounts: Object.fromEntries([...this.accounts.values()].map((a) => [a.code, a.entity.id])),
          banks: byEntity,
        },
        chart: this.chart,
        openingBalances: { asAt: FY_START, source: "Last year's signed accounts", accounts: this.opening },
        assets: [],
        invoices: [],
        taxExtras: [],
        singleEntityConfirmed: this.entities.length === 1,
        aiEnabled: true,
        ...(exampleAiSuggestions.length > 0 ? { exampleAiSuggestions } : {}),
        ...more,
      },
    };
  }
}

function write(name, built) {
  const folder = join(out, name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "ledger.json"), `${JSON.stringify(built.json, null, 1)}\n`);
  const coded = Object.keys(built.json.overrides).length;
  console.log(`${name}: ${built.transactions.length} lines, ${built.transactions.length - coded} left to code. ${built.summary.join("; ")}.`);
}

// ===========================================================================
// An incorporated society: a sailing club, not registered for GST.
// ===========================================================================
{
  const club = {
    id: "harbourside-sailing-club",
    name: "Harbourside Sailing Club Incorporated",
    note: "An incorporated society",
    about:
      "A volunteer-run sailing club on Nelson's waterfront: 124 members, junior learn-to-sail, a clubroom bar, " +
      "one regatta a year, and a grant this year to renew the training fleet.",
    kind: "nonprofit",
    gstRegistered: false,
    owners: [],
    nonprofit: { form: "society" },
  };
  const b = new Book({
    slug: "society",
    entities: [club],
    accounts: [
      ["400", "Subscriptions", "Revenue", "e"],
      ["410", "Bar and canteen sales", "Revenue", "e"],
      ["420", "Grants", "Revenue", "e"],
      ["430", "Donations", "Revenue", "e"],
      ["440", "Regatta entry fees", "Revenue", "e"],
      ["500", "Insurance", "Expense", "e"],
      ["510", "Boat repairs and maintenance", "Expense", "e"],
      ["515", "Training fleet purchases", "Expense", "e"],
      ["520", "Coaching", "Expense", "e"],
      ["530", "Clubroom lease", "Expense", "e"],
      ["535", "Clubroom power", "Expense", "e"],
      ["540", "Bar and canteen stock", "Expense", "e"],
      ["550", "Regatta costs", "Expense", "e"],
      ["560", "Affiliation fees", "Expense", "e"],
      ["570", "Printing and stationery", "Expense", "e"],
      ["580", "Bank fees", "Expense", "e"],
      ["585", "Telephone and internet", "Expense", "e"],
      ["810", "Grants received in advance", "Current Liability", "o"],
      ["960", "Accumulated funds", "Retained Earnings", "o"],
    ],
  });
  const bank = b.bank("03-0702-0345678-000", "Harbourside Sailing Club Cheque");
  b.open(bank, 2_428_640);
  b.open("960", -2_428_640);

  // 124 members: 72 seniors at $150, 38 juniors at $60, 14 families at $220.
  const subs = [
    ["2025-04-07", 486_000, "Senior subscriptions, 32"], // 32 x 150 + ...
    ["2025-04-22", 216_000, "Junior and family subscriptions"],
    ["2025-05-12", 330_000, "Senior subscriptions, 22"],
    ["2025-09-15", 298_000, "Season start, seniors and families"],
    ["2025-10-06", 286_000, "Late joiners"],
  ];
  const subsTotal = subs.reduce((s, [, a]) => s + a, 0);
  if (subsTotal !== 72 * 15_000 + 38 * 6_000 + 14 * 22_000) throw new Error(`society: subscriptions ${dollars(subsTotal)}`);
  for (const [date, amount, note] of subs) b.line(bank, date, amount, "Members' subscriptions", "400", note);

  // Bar takings, banked monthly: quiet in winter, busy through the racing season.
  const bar = [42_000, 26_000, 18_000, 16_000, 19_000, 31_000, 52_000, 64_000, 72_000, 88_000, 76_000, 61_000];
  MONTHS.forEach(([y, m], i) => b.line(bank, day(y, m, 2 + (i % 3)), bar[i], "Clubroom bar takings", "410", "Bar and canteen, banked monthly"));

  b.line(bank, "2025-06-18", 600_000, "Tasman Community Trust", "420", "Grant to replace two training dinghies", { reference: "Grant 2025/114" });
  b.line(bank, "2025-11-05", 25_000, "Nelson Rotary Club", "430", "Donation toward the youth programme");
  b.line(bank, "2026-02-21", 8_000, "A Pennington", "430", "Donation");
  // 46 boats at $35.
  b.line(bank, "2026-01-12", 77_000, "Regatta entries", "440", "22 entries, online");
  b.line(bank, "2026-01-17", 84_000, "Regatta entries", "440", "24 entries, on the day");

  b.line(bank, "2025-05-12", -184_000, "Marsden Marine Insurance", "500", "Boats, clubroom and liability, annual");
  b.line(bank, "2025-07-24", -318_500, "Sunburst Sailboats Ltd", "515", "Two training dinghies, from the grant");
  b.line(bank, "2025-08-09", -64_200, "Sunburst Sailboats Ltd", "515", "Sails and fittings for the new dinghies");
  b.line(bank, "2025-10-30", -22_800, "Port Nelson Marine Services", "510", "Rescue boat engine service");
  for (const [date, amount] of [["2025-06-03", 72_000], ["2025-09-08", 72_000], ["2025-12-10", 96_000]]) {
    b.line(bank, date, -amount, "Mel Turei Coaching", "520", "Learn-to-sail coaching block");
  }
  const power = [11_240, 12_810, 14_150, 14_720, 13_930, 11_860, 9_640, 8_420, 7_910, 8_830, 9_140, 10_270];
  MONTHS.forEach(([y, m], i) => {
    b.line(bank, day(y, m, 10), -42_000, "Port Nelson Ltd", "530", "Clubroom ground lease");
    b.line(bank, day(y, m, 22), -power[i], "Contact Energy", "535", "Clubroom power");
    b.line(bank, day(y, m, 28), -500, "Kiwibank", "580", "Account fee");
  });
  for (const [date, amount] of [["2025-05-29", 48_000], ["2025-08-14", 52_500], ["2025-11-20", 39_000], ["2026-02-12", 61_000]]) {
    b.line(bank, date, -amount, "Gilmour Beverages", "540", "Bar stock");
  }
  b.line(bank, "2026-01-10", -86_500, "Top Tent Hire", "550", "Marquee and tables for the regatta");
  b.line(bank, "2026-01-16", -34_200, "Trophy World Nelson", "550", "Regatta trophies and prizes");
  b.line(bank, "2025-06-02", -28_000, "Yachting New Zealand", "560", "Club affiliation");
  // Left to code.
  b.line(bank, "2026-03-04", -14_600, "Mitre 10 Nelson", undefined, undefined, {
    particulars: "Paint and varnish",
    example: { code: "510", confidence: 0.86, because: "Paint and varnish from a hardware store: most likely for the boats or the clubroom." },
  });
  b.line(bank, "2026-03-11", -9_500, "Anchor Printing", undefined, undefined, {
    particulars: "Regatta programmes",
    example: {
      code: "550", confidence: 0.71, because: "Printed programmes are part of putting on the regatta.",
      caution: "Printing and stationery would do as well; keep it with the regatta if you report on it.",
    },
  });
  b.line(bank, "2026-03-19", 12_000, "B Hartley Ltd", undefined, undefined, {
    particulars: "Programme advert",
    example: {
      code: "430", confidence: 0.48, because: "Money in from a local business, with a programme advert as the reference.",
      caution: "An advert is sponsorship, not a gift: something was given in return. A Sponsorship account would be better.",
    },
  });
  // The clubroom's new broadband: a payee on the list of known NZ businesses.
  b.line(bank, "2026-03-26", -5_999, "Spark", undefined, undefined, { particulars: "Clubroom broadband" });

  const built = b.build({
    // The figures the reporting standard is decided by, as each year's signed
    // statements gave them. This year's are the books' own once the three
    // lines left are coded.
    societyReports: {
      [`${club.id}:2024`]: { figures: { operatingPayments: 1_587_210, currentAssets: 2_170_580, totalExpenses: 1_587_210 } },
      [`${club.id}:2025`]: { figures: { operatingPayments: 1_694_050, currentAssets: 2_428_640, totalExpenses: 1_694_050 } },
      [`${club.id}:2026`]: {
        figures: { operatingPayments: 1_851_719, currentAssets: 3_563_921, totalExpenses: 1_851_719 },
        signers: ["Kate Rowe, Commodore", "Tom Hira, Treasurer"],
      },
    },
    grants: [
      {
        id: "tct-2025-114",
        entityId: club.id,
        funder: "Tasman Community Trust",
        purpose: "Replace two worn training dinghies and fit them out",
        amount: 600_000,
        from: "2025-06-01",
        to: "2026-12-31",
        conditions: "To be spent on the training fleet. A report with receipts is due once it is spent; any unspent money is returned.",
        conditional: true,
        reportDue: "2027-01-31",
      },
    ],
  });
  built.json.grantLinks = Object.fromEntries(
    built.transactions
      .filter((t) => t.otherParty === "Tasman Community Trust" || t.otherParty === "Sunburst Sailboats Ltd")
      .map((t) => [t.id, "tct-2025-114"]),
  );
  write("society", built);
}

// ===========================================================================
// A family trust: one rental house and a term deposit, not registered for GST.
// ===========================================================================
{
  const trust = {
    id: "whitcombe-family-trust",
    name: "Whitcombe Family Trust",
    note: "A complying trust",
    about:
      "Settled by Joan Whitcombe in 2014. Owns 8 Totara Place, a rental let at $780 a week through Harcourts, " +
      "and a term deposit. The house was sold to the trust for a loan Joan holds. Income is allocated to Ana " +
      "and Tom each year.",
    kind: "trust",
    gstRegistered: false,
    owners: [],
    trust: {
      type: "complying",
      deed: "2014-06-12",
      irdNumber: ird(118_442_000),
      registered: true,
      settlors: [{ id: "s1", name: "Joan Whitcombe", residence: "NZ" }],
      appointers: [{ id: "a1", name: "Joan Whitcombe", since: "2014-06-12", residence: "NZ" }],
      beneficiaries: [
        { id: "b1", name: "Ana Whitcombe", born: "1984-03-02", residence: "NZ", irdNumber: ird(104_220_300), accountCode: "811" },
        { id: "b2", name: "Tom Whitcombe", born: "1982-09-19", residence: "NZ", irdNumber: ird(104_330_400), accountCode: "812" },
        { id: "b3", name: "Maia Whitcombe", born: "2012-07-30", residence: "NZ" },
      ],
    },
  };
  const b = new Book({
    slug: "trust",
    entities: [trust],
    accounts: [
      ["200", "Rent received", "Revenue", "e"],
      ["270", "Interest received", "Revenue", "e"],
      ["404", "Bank fees", "Expense", "e"],
      ["412", "Accounting fees", "Expense", "e"],
      ["433", "Insurance", "Expense", "e"],
      ["437", "Mortgage interest", "Expense", "e"],
      ["445", "Rates", "Expense", "e"],
      ["473", "Repairs and maintenance", "Expense", "e"],
      ["490", "Property management fees", "Expense", "e"],
      ["495", "Postage and courier", "Expense", "e"],
      ["610", "Term deposit, Kiwibank", "Current Asset", "o"],
      ["720", "Land and buildings, 8 Totara Place", "Fixed Asset", "o"],
      ["811", "Beneficiary current account, Ana Whitcombe", "Current Liability", "o"],
      ["812", "Beneficiary current account, Tom Whitcombe", "Current Liability", "o"],
      ["900", "Westpac loan", "Non-current Liability", "o"],
      ["910", "Loan from Joan Whitcombe", "Non-current Liability", "o"],
      ["960", "Accumulated trust income", "Retained Earnings", "o"],
      ["970", "Trust capital", "Equity", "o"],
      ["975", "Beneficiary income allocated", "Equity", "o"],
    ],
  });
  const bank = b.bank("38-9014-0789012-000", "Whitcombe Family Trust");
  b.open(bank, 984_015);
  b.open("610", 5_500_000);
  b.open("720", 68_500_000);
  b.open("900", -43_200_000);
  b.open("910", -25_000_000);
  b.open("970", -10_000);
  b.open("960", -(984_015 + 5_500_000 + 68_500_000 - 43_200_000 - 25_000_000 - 10_000));

  // $780 a week; Harcourts pays the month's rent across and charges 8% + GST.
  const rent = 338_000;
  const fee = Math.round(rent * 0.092);
  // $432,000 interest-only at 6.19%.
  const interest = Math.round((43_200_000 * 0.0619) / 12);
  MONTHS.forEach(([y, m]) => {
    b.line(bank, day(y, m, 5), rent, "Harcourts Nelson", "200", "Rent, 8 Totara Place");
    b.line(bank, day(y, m, 5), -fee, "Harcourts Nelson", "490", "Management fee, 8% plus GST");
    b.line(bank, day(y, m, 15), -interest, "Westpac", "437", "Loan interest, interest only");
    b.line(bank, day(y, m, 28), -500, "Westpac", "404", "Account fee");
  });
  for (const date of ["2025-08-28", "2025-11-28", "2026-02-27", "2025-05-30"]) {
    b.line(bank, date, -103_000, "Nelson City Council", "445", "Rates instalment");
  }
  b.line(bank, "2025-05-14", -218_400, "Tower Insurance", "433", "House and landlord insurance, annual");
  b.line(bank, "2025-07-08", -41_200, "Tasman Plumbing", "473", "Hot water cylinder valve");
  b.line(bank, "2025-10-21", -28_800, "Glen's Gardens", "473", "Section tidy between tenants");
  b.line(bank, "2025-06-20", -172_500, "Nelson Tax & Accounting", "412", "Last year's accounts and IR6");
  // $55,000 at 4.90%, interest six-monthly, RWT taken at 33%.
  const tdGross = Math.round((5_500_000 * 0.049) / 2);
  const tdRwt = Math.round(tdGross * 0.33);
  for (const date of ["2025-09-30", "2026-03-31"]) {
    b.line(bank, date, tdGross - tdRwt, "Kiwibank", "270", `Term deposit interest ${dollars(tdGross)} less RWT ${dollars(tdRwt)}`);
  }
  // Left to code.
  b.line(bank, "2026-03-06", -36_700, "Bunnings Nelson", undefined, undefined, {
    particulars: "Fence palings",
    example: {
      code: "473", confidence: 0.9, because: "Fence palings for the rental: mending the existing fence.",
      caution: "A whole new fence would be capital, not a repair.",
    },
  });
  b.line(bank, "2026-03-18", -9_600, "Smoke Alarm Services NZ", undefined, undefined, {
    particulars: "Annual check",
    example: { code: "473", confidence: 0.82, because: "The yearly smoke alarm check at 8 Totara Place, a landlord's obligation." },
  });
  b.line(bank, "2026-03-24", -1_430, "NZ Post", undefined, undefined, { particulars: "Registered letter to tenant" });

  // Each beneficiary is allocated $1,500 of the year's income, credited to
  // their account rather than paid: the trustees' resolution at balance date.
  const allocation = 150_000;
  const built = b.build({
    manualJournals: [
      {
        id: "trust-allocation-2026",
        date: FY_END,
        narration: "Beneficiary income allocated by trustees' resolution of 31 March 2026",
        lines: [
          { code: "Beneficiary income allocated - 975", amount: allocation * 2, description: "Income allocated" },
          { code: "Beneficiary current account, Ana Whitcombe - 811", amount: -allocation, description: "Ana Whitcombe" },
          { code: "Beneficiary current account, Tom Whitcombe - 812", amount: -allocation, description: "Tom Whitcombe" },
        ],
      },
    ],
    trustReturns: {
      [`${trust.id}:2026`]: {
        classes: { "200": "residential" },
        placements: { "433": "residential", "437": "residential", "445": "residential", "473": "residential", "490": "residential" },
        rwtInterest: tdRwt * 2,
        allocations: { b1: allocation, b2: allocation },
        otherIncome: { b1: 7_248_000, b2: 5_860_000 },
        taxableDistributions: {},
        openingBalances: { b1: 0, b2: 0 },
        distributionsTaxable: {},
        distributionsNotTaxable: {},
        withdrawals: {},
        settlements: {},
        placementsOfBalances: { "720": "land", "910": "associated" },
      },
    },
  });
  write("trust", built);
}

// ===========================================================================
// A person: a salary, a rental flat, savings and shares, and the IR3.
// ===========================================================================
{
  const sam = {
    id: "sam-taylor",
    name: "Sam Taylor",
    note: "Sam's own accounts",
    about: "A physiotherapist at Nelson Hospital on $83,200, with a home loan, some shares, and a rented flat.",
    kind: "personal",
    gstRegistered: false,
    owners: [{ name: "Sam Taylor", percent: 100 }],
  };
  const flat = {
    id: "flat-2-kawai-street",
    name: "Flat 2, 14 Kawai Street",
    note: "Residential rental, Sam's alone",
    about: "A two-bedroom flat let at $560 a week, managed by Sam. Interest-only loan.",
    kind: "residential",
    gstRegistered: false,
    owners: [{ name: "Sam Taylor", percent: 100 }],
  };
  const b = new Book({
    slug: "personal",
    entities: [sam, flat],
    accounts: [
      ["200", "Salary (net pay)", "Revenue", "e", sam.id],
      ["270", "Interest (after RWT)", "Revenue", "e", sam.id],
      ["275", "Dividends (cash received)", "Revenue", "e", sam.id],
      ["420", "Donations", "Expense", "e", sam.id],
      ["430", "Health and dental", "Expense", "e", sam.id],
      ["440", "Insurance", "Expense", "e", sam.id],
      ["450", "Power and internet", "Expense", "e", sam.id],
      ["455", "Rates, home", "Expense", "e", sam.id],
      ["460", "Home loan interest", "Expense", "e", sam.id],
      ["470", "Groceries and household", "Expense", "e", sam.id],
      ["720", "Home, 9 Ngaio Rise", "Fixed Asset", "o", sam.id],
      ["900", "Home loan, ASB", "Non-current Liability", "o", sam.id],
      ["960", "Net worth", "Retained Earnings", "o", sam.id],
      ["200R", "Rent received", "Revenue", "e", flat.id],
      ["404R", "Bank fees", "Expense", "e", flat.id],
      ["433R", "Insurance", "Expense", "e", flat.id],
      ["437R", "Mortgage interest", "Expense", "e", flat.id],
      ["445R", "Rates", "Expense", "e", flat.id],
      ["473R", "Repairs and maintenance", "Expense", "e", flat.id],
      ["449R", "Motor vehicle expenses", "Expense", "e", flat.id],
      ["720R", "Flat 2, 14 Kawai Street", "Fixed Asset", "o", flat.id],
      ["900R", "Rental loan, ASB", "Non-current Liability", "o", flat.id],
      ["970R", "Owner's capital, Kawai Street", "Equity", "o", flat.id],
      ["980R", "Capital withdrawn, Kawai Street", "Equity", "o", flat.id],
    ],
  });
  const everyday = b.bank("12-3140-0456789-000", "Sam Taylor Everyday", sam.id);
  const rental = b.bank("12-3140-0456789-050", "Kawai Street Rental", flat.id);

  // Opening position: a home with a loan, and the flat with its own.
  b.open(everyday, 485_020);
  b.open("720", 72_000_000);
  b.open("900", -41_200_000);
  b.open("960", -(485_020 + 72_000_000 - 41_200_000));
  b.open(rental, 460_000);
  b.open("720R", 54_500_000);
  b.open("900R", -38_000_000);
  b.open("970R", -(460_000 + 54_500_000 - 38_000_000));

  // Pay, worked out by the same payroll rules the app uses: $83,200 a year,
  // monthly, tax code M, KiwiSaver at 3%.
  const employee = {
    id: "sam", name: "Sam Taylor", irdNumber: ird(112_334_000), taxCode: "M", payFrequency: "monthly",
    annualSalary: 8_320_000, kiwiSaverRate: 0.03, kiwiSaverEmployerRate: 0.03, esctRate: 0.175, bankAccount: everyday,
  };
  const monthly = Math.round(8_320_000 / 12);
  let gross = 0;
  let paye = 0;
  MONTHS.forEach(([y, m]) => {
    const line = calculatePayLine(employee, monthly, 2026);
    gross += line.gross;
    paye += line.paye + line.studentLoan;
    b.line(everyday, day(y, m, 15), line.netPay, "Te Whatu Ora Nelson Marlborough", "200", "Salary, after PAYE and KiwiSaver");
  });

  // Savings interest after RWT at 33%, and NZX dividends with imputation
  // credits at 28/72 and RWT making up the rest to 33%.
  const interest = [[day(2025, 9, 30), 30_000], [day(2026, 3, 31), 33_600]];
  let interestGross = 0;
  let interestRwt = 0;
  for (const [date, g] of interest) {
    const rwt = Math.round(g * 0.33);
    interestGross += g;
    interestRwt += rwt;
    b.line(everyday, date, g - rwt, "ASB", "270", `Savings interest ${dollars(g)} less RWT ${dollars(rwt)}`);
  }
  const dividends = [[day(2025, 9, 19), 60_000, "Contact Energy"], [day(2026, 3, 20), 55_000, "Fisher & Paykel Healthcare"]];
  let divGross = 0;
  let divImputation = 0;
  let divRwt = 0;
  for (const [date, g, payer] of dividends) {
    const imputation = Math.round(g * 0.28);
    const rwt = Math.round(g * 0.05);
    divGross += g;
    divImputation += imputation;
    divRwt += rwt;
    b.line(everyday, date, g - imputation - rwt, payer, "275", "Dividend after imputation credits and RWT");
  }

  // The household.
  const power = [16_800, 18_700, 21_400, 22_100, 20_900, 17_600, 14_300, 12_100, 11_400, 11_900, 12_300, 14_200];
  const groceries = [68_400, 71_200, 66_900, 73_800, 69_500, 70_100, 72_600, 74_300, 88_900, 71_400, 67_800, 70_500];
  // $412,000 at 5.39% over 25 years: interest falls a little each month as the principal is repaid.
  let homeLoan = 41_200_000;
  const homePayment = 250_000;
  MONTHS.forEach(([y, m], i) => {
    const homeInterest = Math.round((homeLoan * 0.0539) / 12);
    homeLoan -= homePayment - homeInterest;
    b.line(everyday, day(y, m, 16), -homeInterest, "ASB home loan", "460", "Interest");
    b.line(everyday, day(y, m, 16), -(homePayment - homeInterest), "ASB home loan", "900", "Principal");
    b.line(everyday, day(y, m, 7), -power[i], "Contact Energy", "450", "Power");
    b.line(everyday, day(y, m, 9), -8_999, "One NZ", "450", "Fibre and mobile");
    b.line(everyday, day(y, m, 1), -12_400, "AIA New Zealand", "440", "Life and income protection");
    b.line(everyday, day(y, m, 20), -groceries[i], "Woolworths Richmond", "470", "Groceries");
  });
  for (const date of ["2025-05-30", "2025-08-28", "2025-11-28", "2026-02-27"]) {
    b.line(everyday, date, -96_500, "Nelson City Council", "455", "Home rates instalment");
  }
  b.line(everyday, "2025-08-14", -6_500, "Richmond Medical Centre", "430", "GP visit");
  b.line(everyday, "2025-11-03", -28_200, "Nelson Dental", "430", "Dentist");
  b.line(everyday, "2025-12-05", -10_000, "Cancer Society", "420", "Donation");
  b.line(everyday, "2026-03-02", -15_000, "Nelson Tasman Hospice", "420", "Donation");

  // The flat: $560 a week, paid fortnightly by the tenant; $380,000 interest-only at 5.95%.
  let fortnight = "2025-04-04";
  while (fortnight <= FY_END) {
    b.line(rental, fortnight, 112_000, "J Ruatapu", "200R", "Rent, two weeks");
    fortnight = addDays(fortnight, 14);
  }
  const rentalInterest = Math.round((38_000_000 * 0.0595) / 12);
  MONTHS.forEach(([y, m]) => {
    b.line(rental, day(y, m, 18), -rentalInterest, "ASB rental loan", "437R", "Interest only");
    b.line(rental, day(y, m, 28), -500, "ASB", "404R", "Account fee");
  });
  for (const date of ["2025-05-30", "2025-08-28", "2025-11-28", "2026-02-27"]) {
    b.line(rental, date, -71_000, "Nelson City Council", "445R", "Flat rates instalment");
  }
  b.line(rental, "2025-06-11", -164_800, "AMI Insurance", "433R", "Landlord insurance, annual");
  b.line(rental, "2025-09-22", -38_500, "Tasman Electrical", "473R", "Replace rangehood");
  // What the flat earned beyond its costs, moved across to the household.
  b.line(rental, "2025-12-19", -300_000, "Sam Taylor", "980R", "Rental surplus moved to the everyday account");
  b.line(everyday, "2025-12-19", 300_000, "Sam Taylor", "960", "From the rental account");
  // Left to code.
  b.line(everyday, "2026-03-08", -23_900, "Briscoes Nelson", undefined, undefined, {
    particulars: "Bedding",
    example: { code: "470", confidence: 0.77, because: "Bedding from a homeware store, paid from the everyday account: household spending." },
  });
  b.line(rental, "2026-03-14", -12_650, "Mitre 10 Richmond", undefined, undefined, {
    particulars: "Tap washers and silicone",
    example: { code: "473R", confidence: 0.93, because: "Tap washers and silicone paid from the rental account: a small repair at the flat." },
  });
  // Fuel for a trip to the flat, paid from its account: a known NZ business.
  b.line(rental, "2026-03-21", -6_230, "Z Energy Richmond", undefined, undefined, { particulars: "Fuel" });

  const built = b.build({
    taxExtras: [
      { owner: "Sam Taylor", year: 2026, category: "salary", payer: "Te Whatu Ora", gross, credits: paye },
      { owner: "Sam Taylor", year: 2026, category: "interest", payer: "ASB", gross: interestGross, credits: interestRwt },
      {
        owner: "Sam Taylor", year: 2026, category: "dividends", payer: "Contact Energy, Fisher & Paykel Healthcare",
        gross: divGross, credits: divRwt, imputation: divImputation,
      },
    ],
    ir3Details: [{ owner: "Sam Taylor", year: 2026, provisionalTaxPaid: 0 }],
  });
  write("personal", built);
}

// ===========================================================================
// A business with staff: a bakery company, GST registered, on payroll.
// ===========================================================================
{
  const bakery = {
    id: "mapua-bakehouse-limited",
    name: "Māpua Bakehouse Limited",
    note: "A company with three staff",
    about:
      "A bakery and café in Māpua, owned by Rewi and Hannah Moana. Bread and pastries over the counter, " +
      "banked from the EFTPOS terminal every week. Three staff on fortnightly pay.",
    kind: "business",
    structure: "company",
    gstRegistered: true,
    gstFrequency: 2,
    owners: [],
    shareholders: [{ name: "Rewi Moana", percent: 50 }, { name: "Hannah Moana", percent: 50 }],
    holderIrd: { "Rewi Moana": ird(98_765_400), "Hannah Moana": ird(99_112_300) },
  };
  const b = new Book({
    slug: "payroll",
    entities: [bakery],
    accounts: [
      ["200", "Sales", "Revenue", "s"],
      ["310", "Ingredients", "Direct Costs", "s"],
      ["315", "Packaging", "Direct Costs", "s"],
      ["400", "Advertising", "Overhead", "s"],
      ["404", "Bank fees", "Overhead", "e"],
      ["405", "EFTPOS terminal fees", "Overhead", "s"],
      ["425", "Freight & Courier", "Overhead", "s"],
      ["412", "Consulting & Accounting", "Overhead", "s"],
      ["416", "Depreciation", "Overhead", "o"],
      ["433", "Insurance", "Overhead", "s"],
      ["445", "Light, Power, Heating", "Overhead", "s"],
      ["469", "Rent", "Overhead", "s"],
      ["473", "Repairs and Maintenance", "Overhead", "s"],
      ["477", "Salaries", "Overhead", "o"],
      ["478", "KiwiSaver Employer Contributions", "Overhead", "o"],
      ["489", "Telephone & Internet", "Overhead", "s"],
      ["730", "Plant and Equipment", "Fixed Asset", "o"],
      ["731", "Less Accumulated Depreciation on Plant and Equipment", "Fixed Asset", "o"],
      ["814", "Wages Payable - Payroll", "Current Liability", "o"],
      ["820", "GST", "GST", "o"],
      ["825", "PAYE Payable", "Current Liability", "o"],
      ["830", "Income Tax", "Current Liability", "o"],
      ["881", "Shareholder current account, Rewi Moana", "Current Liability", "o"],
      ["882", "Shareholder current account, Hannah Moana", "Current Liability", "o"],
      ["950", "Share capital", "Equity", "o"],
      ["960", "Retained Earnings", "Retained Earnings", "o"],
    ],
  });
  const bank = b.bank("02-0712-0067890-000", "Māpua Bakehouse Trading");

  // The oven and the rest, straight line, full months.
  const assets = [
    { number: "FA-0001", name: "Deck oven, four deck", type: "Plant and Equipment", status: "Registered", purchased: "2023-05-10", depreciationFrom: "2023-05-10", cost: 3_800_000, rate: 10, method: "Straight Line", averaging: "Full Month", disposed: null },
    { number: "FA-0002", name: "Spiral dough mixer", type: "Plant and Equipment", status: "Registered", purchased: "2023-05-10", depreciationFrom: "2023-05-10", cost: 1_250_000, rate: 12.5, method: "Straight Line", averaging: "Full Month", disposed: null },
    { number: "FA-0003", name: "Espresso machine, two group", type: "Plant and Equipment", status: "Registered", purchased: "2024-02-19", depreciationFrom: "2024-02-19", cost: 940_000, rate: 20, method: "Straight Line", averaging: "Full Month", disposed: null },
  ];
  const monthsTo = (purchased, end) => {
    const [py, pm] = purchased.split("-").map(Number);
    const [ey, em] = end.split("-").map(Number);
    return (ey - py) * 12 + (em - pm) + 1;
  };
  const priorDepreciation = assets.reduce(
    (s, a) => s + Math.round((a.cost * a.rate) / 100 / 12 * monthsTo(a.purchased, "2025-03-31")), 0);

  // GST: worked out here exactly as the return works it out, period by period.
  const gstSales = new Map();
  const gstPurchases = new Map();
  const periodOf = (iso) => {
    const [y, m] = iso.split("-").map(Number);
    // Two-monthly, for a 31 March balance date: April-May, June-July ... February-March.
    if (m === 1) return `${y - 1}-12`;
    const start = m % 2 === 0 ? m : m - 1;
    return `${y}-${String(start).padStart(2, "0")}`;
  };
  const sale = (date, amount, payee, code, note) => {
    b.line(bank, date, amount, payee, code, note);
    if (b.accounts.get(code).gst === "s") {
      const map = amount > 0 ? gstSales : gstPurchases;
      map.set(periodOf(date), (map.get(periodOf(date)) ?? 0) + Math.abs(amount));
    }
  };

  // Payroll, built by the app's own payroll rules: three staff, fortnightly.
  const employees = [
    { id: "e1", name: "Mere Parata", irdNumber: ird(105_667_100), taxCode: "M", payFrequency: "fortnightly", annualSalary: 5_800_000, kiwiSaverRate: 0.03, kiwiSaverEmployerRate: 0.03, esctRate: 0.3, bankAccount: "03-1354-0456123-000", startDate: "2023-06-01" },
    { id: "e2", name: "Josh Lee", irdNumber: ird(121_884_200), taxCode: "M SL", payFrequency: "fortnightly", hourlyRate: 2_600, standardHours: 64, kiwiSaverRate: 0.04, kiwiSaverEmployerRate: 0.03, esctRate: 0.175, bankAccount: "12-3192-0012345-001", startDate: "2024-01-15" },
    { id: "e3", name: "Aroha Smith", irdNumber: ird(130_225_300), taxCode: "M", payFrequency: "fortnightly", hourlyRate: 2_400, standardHours: 40, kiwiSaverRate: 0.03, kiwiSaverEmployerRate: 0.03, esctRate: 0.175, bankAccount: "06-0501-0234567-000", startDate: "2024-11-04" },
  ];
  const employerIrd = ird(127_550_000);
  const payRuns = [];
  const owedToIr = new Map();
  // Paydays: every second Wednesday from 9 April 2025.
  for (let pay = "2025-04-09"; pay <= FY_END; pay = addDays(pay, 14)) {
    const hours = { e2: 64, e3: pay >= "2025-12-01" && pay <= "2026-02-28" ? 56 : 40 };
    const run = buildPayRun({
      id: `payrun-${pay}`,
      employerIrd,
      periodStart: addDays(pay, -16),
      periodEnd: addDays(pay, -3),
      payDate: pay,
      employees,
      inputs: employees.map((e) => ({ employeeId: e.id, ...(e.hourlyRate ? { hoursWorked: hours[e.id] } : {}) })),
      history: payRuns,
    });
    payRuns.push(run);
    for (const line of run.lines) b.line(bank, pay, -line.netPay, line.employeeName, "814", "Net pay");
    const journal = payrollJournal(run, {
      wages: { code: "477", name: "Salaries" },
      kiwiSaverExpense: { code: "478", name: "KiwiSaver Employer Contributions" },
      wagesPayable: { code: "814", name: "Wages Payable - Payroll" },
      payePayable: { code: "825", name: "PAYE Payable" },
    });
    const toIr = -journal.lines.filter((l) => l.accountCode === "825").reduce((s, l) => s + l.amount, 0);
    const month = pay.slice(0, 7);
    owedToIr.set(month, (owedToIr.get(month) ?? 0) + toIr);
  }
  // PAYE, KiwiSaver and the rest go to Inland Revenue by the 20th of the next month.
  const marchPaye2025 = 261_240;
  b.line(bank, "2025-04-20", -marchPaye2025, "Inland Revenue", "825", "PAYE and KiwiSaver, March 2025");
  for (const [month, amount] of owedToIr) {
    const [y, m] = month.split("-").map(Number);
    const due = m === 12 ? day(y + 1, 1, 20) : day(y, m + 1, 20);
    if (due > FY_END) continue;
    b.line(bank, due, -amount, "Inland Revenue", "825", `PAYE and KiwiSaver, ${month}`);
  }
  const payeOwingAtYearEnd = [...owedToIr].filter(([month]) => month === "2026-03").reduce((s, [, a]) => s + a, 0);

  // Takings: banked from the EFTPOS terminal every Monday, busier in summer.
  const weekly = (iso) => {
    const m = Number(iso.slice(5, 7));
    const base = [0, 8_850_00, 8_500_00, 7_150_00, 6_250_00, 5_800_00, 5_700_00, 5_950_00, 6_400_00, 6_850_00, 7_400_00, 8_300_00, 9_400_00][m];
    const wobble = ((Number(iso.slice(8, 10)) * 37) % 11 - 5) * 4_500;
    return base + wobble;
  };
  for (let monday = "2025-04-07"; monday <= FY_END; monday = addDays(monday, 7)) {
    sale(monday, weekly(monday), "Windcave settlement", "200", "Week's EFTPOS takings");
  }
  // Ingredients every week, packaging monthly, and the overheads.
  for (let tue = "2025-04-08"; tue <= FY_END; tue = addDays(tue, 7)) {
    const takings = weekly(addDays(tue, -1));
    sale(tue, -Math.round(takings * 0.27), "Bakels New Zealand", "310", "Flour, butter and ingredients");
  }
  MONTHS.forEach(([y, m]) => {
    sale(day(y, m, 1), -368_000, "Coastal Property Holdings", "469", "Shop rent, incl GST");
    sale(day(y, m, 12), -Math.round(64_000 + (m >= 5 && m <= 8 ? 26_000 : 0)), "Nelson Packaging Supplies", "315", "Bags, boxes and cups");
    sale(day(y, m, 18), -(m >= 5 && m <= 9 ? 152_000 : 118_000), "Meridian Energy", "445", "Power, ovens and shop");
    sale(day(y, m, 9), -14_900, "Spark", "489", "Phone and fibre");
    sale(day(y, m, 3), -Math.round(weekly(day(y, m, 3)) * 4.3 * 0.009), "Windcave", "405", "Terminal and transaction fees");
    b.line(bank, day(y, m, 28), -1_200, "ANZ", "404", "Account fee");
  });
  sale("2025-07-15", -412_000, "Vero Insurance", "433", "Business and contents insurance, annual");
  sale("2025-06-24", -287_500, "Tasman Accounting Group", "412", "Annual accounts and IR4");
  sale("2025-09-17", -64_400, "Southern Hospitality", "473", "Oven service and seals");
  sale("2026-01-27", -23_000, "Coffee Machine Clinic", "473", "Espresso machine service");

  // Provisional tax for the year, in three instalments.
  for (const date of ["2025-08-28", "2026-01-15"]) b.line(bank, date, -420_000, "Inland Revenue", "830", "Provisional tax instalment");

  // GST for Feb-Mar 2025, owing at the start, paid on 28 May (7 May for the March period).
  const openingGst = 586_420;
  b.line(bank, "2025-05-07", -openingGst, "Inland Revenue", "820", "GST, February and March 2025");
  const periods = ["2025-04", "2025-06", "2025-08", "2025-10", "2025-12", "2026-02"];
  const dueOf = { "2025-04": "2025-06-30", "2025-06": "2025-08-28", "2025-08": "2025-10-28", "2025-10": "2026-01-15", "2025-12": "2026-02-28", "2026-02": "2026-05-07" };
  // Each period's GST, worked out at the period's end, so later lines cannot move it.
  let gstOwingAtYearEnd = 0;
  const gstLines = [];
  for (const p of periods) {
    const collected = Math.round(((gstSales.get(p) ?? 0) * 3) / 23);
    const paid = Math.round(((gstPurchases.get(p) ?? 0) * 3) / 23);
    const owing = collected - paid;
    if (dueOf[p] > FY_END) gstOwingAtYearEnd += owing;
    else gstLines.push([dueOf[p], owing, p]);
  }
  for (const [due, owing, p] of gstLines) {
    const date = due === "2026-02-28" ? "2026-03-02" : due;
    b.line(bank, date, -owing, "Inland Revenue", "820", `GST, period from ${p}`);
  }

  // Opening balances, from last year's signed accounts.
  b.open(bank, 3_154_870);
  b.open("730", assets.reduce((s, a) => s + a.cost, 0));
  b.open("731", -priorDepreciation);
  b.open("820", -openingGst);
  b.open("825", -marchPaye2025);
  b.open("881", -1_500_000);
  b.open("882", -1_500_000);
  b.open("950", -20_000);
  b.open("960", -Object.values(b.opening).reduce((s, v) => s + v, 0));

  // Left to code.
  b.line(bank, "2026-03-10", -18_970, "Mitre 10 Mega Nelson", undefined, undefined, {
    particulars: "Shelving brackets",
    example: {
      code: "473", confidence: 0.64, because: "Shelving brackets from a hardware store.",
      caution: "If this is new shelving rather than a repair, it may belong in Plant and Equipment.",
    },
  });
  b.line(bank, "2026-03-24", -46_000, "Kiwi Signs", undefined, undefined, {
    particulars: "Window signage",
    example: { code: "400", confidence: 0.88, because: "Window signage from a sign maker: promoting the shop." },
  });
  b.line(bank, "2026-03-27", -3_840, "NZ Post", undefined, undefined, { particulars: "Courier bags" });

  const built = b.build({
    assets,
    // Provisional tax on the standard method: last year's $12,000 plus 5%, in
    // three instalments, two paid by balance date.
    ir4Returns: {
      [`${bakery.id}:2026`]: { classes: {}, placements: {}, provisionalPaid: 840_000, lastYearRit: 1_200_000, icaOpening: 985_000, icaIncomeTaxPaid: 840_000 },
    },
    payroll: {
      employerIrd,
      contact: { name: "Hannah Moana", phone: "035401234", email: "accounts@mapuabakehouse.example" },
      accounts: { wages: "477", kiwiSaverExpense: "478", wagesPayable: "814", payePayable: "825" },
      employees,
      payRuns,
    },
  });
  write("payroll", built);
  console.log(
    `  payroll: ${payRuns.length} pay runs; PAYE owing at year end ${dollars(payeOwingAtYearEnd)}; ` +
      `GST owing at year end ${dollars(gstOwingAtYearEnd)}.`,
  );
}
