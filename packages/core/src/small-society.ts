import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Account } from "./chart.js";
import type { PostedJournal } from "./posting.js";
import { incomeAndExpenses } from "./ir9.js";
import type { AccountAmount } from "./ir9.js";
import type { Tier3Inputs } from "./tier3-report.js";

/**
 * Which financial reporting standard an organisation uses, and the financial
 * statements of a small incorporated society.
 *
 * From the Companies Office's "Financial reporting standards for small
 * societies" and the XRB's pages on reporting tiers for incorporated
 * societies, read in October 2026. Check them again before relying on this:
 *
 * - A society is a small society if it is not a registered charity or a donee
 *   organisation and, in each of the last two financial years, its operating
 *   payments and its current assets were each under $50,000. Operating payments
 *   are measured on a cash basis and leave out depreciation, money owed, and
 *   capital spending such as land, buildings and equipment.
 * - A small society's minimum financial statements are: its income and
 *   expenditure (or receipts and payments) for the year; its assets and
 *   liabilities, current and non-current, at the end of the year; and the
 *   mortgages, charges and other security interests over its property at the
 *   end of the year.
 * - Otherwise it uses an XRB standard: Tier 4, the cash standard, unless its
 *   operating payments were $140,000 or more in each of the two preceding
 *   years (Financial Reporting Act 2013, s 46); then Tier 3, which is accrual,
 *   unless total expenses were over $5 million in each of them (Tier 2; over
 *   $33 million, Tier 1). A registered charity reports to Charities Services
 *   under the XRB standards whatever its size.
 * - Financial statements are due within six months of balance date, presented
 *   to members at the annual general meeting, dated, and signed by two
 *   committee members.
 */

/** What the committee says for the society's statements, by year. */
export interface SocietyInputs {
  /** The standard chosen where it differs from what the figures suggest. */
  standard?: ReportingStandard | undefined;
  /** This year's own figures, as its signed statements give them: they decide the next two years' standard. */
  figures?: SocietyYearFigures | undefined;
  securityInterests?: string | undefined;
  signers?: [string, string] | undefined;
  approvedOn?: IsoDate | undefined;
  tier3?: Tier3Inputs | undefined;
}

export const SMALL_SOCIETY_LIMIT: Cents = 5_000_000;
export const TIER4_LIMIT: Cents = 14_000_000;
/** Total expenses above which Tier 3 is no longer open: Tier 2, for years ending 31 March 2024 on. */
export const TIER3_LIMIT: Cents = 500_000_000;
/** Total expenses above which Tier 1 applies. */
export const TIER2_LIMIT: Cents = 3_300_000_000;

export type ReportingStandard = "small-society" | "tier-4" | "tier-3" | "tier-2";

/**
 * A year's own figures, as its signed financial statements give them. These,
 * not the books, decide the standard: books that start part-way through those
 * years, or were not imported for all of them, understate them.
 */
export interface SocietyYearFigures {
  operatingPayments?: Cents | undefined;
  currentAssets?: Cents | undefined;
  totalExpenses?: Cents | undefined;
}

export interface StandardAnswer {
  standard: ReportingStandard;
  /** The reasons, in words. */
  reasons: string[];
}

const dollars = (cents: number): string => `$${Math.round(cents / 100).toLocaleString("en-NZ")}`;

/**
 * What applies this year, from the two years before it.
 *
 * The size tests are on the two preceding years, each of them: a society is a
 * small society only if both years were under both $50,000 limits; Tier 4 is
 * open unless operating payments were $140,000 or more in both years (the
 * Financial Reporting Act's "specified not-for-profit entity"); and Tier 3
 * unless total expenses were over $5 million in both. Crossing a line once
 * moves nobody: it takes two years in a row.
 */
export function reportingStandard(options: {
  registeredCharity: boolean;
  donee: boolean;
  /** Operating payments, cash basis, for the last financial year and the one before it. */
  operatingPayments: readonly [Cents, Cents];
  /** Current assets at the end of each of them. */
  currentAssets: readonly [Cents, Cents];
  /** Total expenses, accrual basis, for each of them, where known. */
  totalExpenses?: readonly [Cents, Cents] | undefined;
  /** Not used: this year's figures decide next year's standard, not this one's. Kept for callers. */
  thisYearPayments?: Cents | undefined;
}): StandardAnswer {
  const reasons: string[] = [];
  const both = (pair: readonly [Cents, Cents], test: (c: Cents) => boolean): boolean => pair.every(test);
  const paymentsUnder = both(options.operatingPayments, (p) => p < SMALL_SOCIETY_LIMIT);
  const assetsUnder = both(options.currentAssets, (a) => a < SMALL_SOCIETY_LIMIT);
  const exempt = !options.registeredCharity && !options.donee;
  if (exempt && paymentsUnder && assetsUnder) {
    reasons.push("It is not a registered charity or a donee organisation, and in each of the last two years its operating payments and its current assets were both under $50,000.");
    reasons.push("It may report to a higher standard if it likes: Tier 4 (cash) or Tier 3 (accrual).");
    return { standard: "small-society", reasons };
  }
  if (!exempt) {
    reasons.push(
      options.registeredCharity
        ? "It is a registered charity, so it reports to Charities Services under the XRB standards whatever its size."
        : "It is a donee organisation, so it reports under the XRB standards whatever its size.",
    );
  } else {
    if (!paymentsUnder) reasons.push("Its operating payments were $50,000 or more in one of the last two years.");
    if (!assetsUnder) reasons.push("Its current assets were $50,000 or more at the end of one of the last two years.");
  }

  const expenses = options.totalExpenses;
  if (expenses !== undefined && both(expenses, (e) => e > TIER3_LIMIT)) {
    const tier1 = both(expenses, (e) => e > TIER2_LIMIT);
    reasons.push(
      tier1
        ? "Total expenses were over $33 million in both of the last two years: Tier 1, full PBE Standards. That is beyond what NZOSA prepares; it needs an accountant."
        : "Total expenses were over $5 million in both of the last two years: Tier 2, PBE Standards with reduced disclosure. That is beyond what NZOSA prepares; it needs an accountant.",
    );
    return { standard: "tier-2", reasons };
  }

  const [last, before] = options.operatingPayments;
  if (last >= TIER4_LIMIT && before >= TIER4_LIMIT) {
    reasons.push(
      `Operating payments were $140,000 or more in both of the last two years (${dollars(last)} and ${dollars(before)}), so the Tier 3 accrual standard applies.`,
    );
    return { standard: "tier-3", reasons };
  }
  if (last >= TIER4_LIMIT || before >= TIER4_LIMIT) {
    reasons.push(
      "Operating payments were $140,000 or more in only one of the last two years, so the Tier 4 cash standard can still be used. " +
        "Two years in a row over $140,000 means Tier 3 from the year after.",
    );
  } else {
    reasons.push("Operating payments were under $140,000 in the last two years, so it can use the Tier 4 cash standard.");
  }
  if (expenses !== undefined && expenses.some((e) => e > TIER3_LIMIT)) {
    reasons.push("Total expenses were over $5 million in one of the last two years: a second such year means Tier 2.");
  }
  return { standard: "tier-4", reasons };
}

export function standardName(s: ReportingStandard): string {
  return s === "small-society"
    ? "Small society minimum requirements"
    : s === "tier-4"
      ? "Tier 4 (NFP), cash"
      : s === "tier-3"
        ? "Tier 3 (NFP), accrual"
        : "Tier 2 (PBE Standards RDR), or Tier 1 over $33 million";
}

export interface SmallSocietyStatements {
  from: IsoDate;
  to: IsoDate;
  income: AccountAmount[];
  expenses: AccountAmount[];
  totalIncome: Cents;
  totalExpenses: Cents;
  surplus: Cents;
  currentAssets: AccountAmount[];
  fixedAssets: AccountAmount[];
  currentLiabilities: AccountAmount[];
  nonCurrentLiabilities: AccountAmount[];
  totalAssets: Cents;
  totalLiabilities: Cents;
  /** Assets less liabilities: the society's accumulated funds. */
  netAssets: Cents;
}

const sum = (rows: readonly AccountAmount[]): Cents => rows.reduce((s, r) => s + r.amount, 0) as Cents;

/** Income and expenditure for the year and assets and liabilities at its end, from the books. */
export function smallSocietyStatements(options: {
  journals: readonly PostedJournal[];
  chart: readonly Account[];
  from: IsoDate;
  to: IsoDate;
  only?: ((account: Account) => boolean) | undefined;
}): SmallSocietyStatements {
  const { income, expenses } = incomeAndExpenses(options);
  const balance = new Map<string, number>();
  for (const j of options.journals) {
    if (j.date > options.to) continue;
    for (const l of j.lines) balance.set(l.accountCode.trim(), (balance.get(l.accountCode.trim()) ?? 0) + l.amount);
  }
  const currentAssets: AccountAmount[] = [];
  const fixedAssets: AccountAmount[] = [];
  const currentLiabilities: AccountAmount[] = [];
  const nonCurrentLiabilities: AccountAmount[] = [];
  for (const account of options.chart) {
    if (options.only !== undefined && !options.only(account)) continue;
    // A bank account's lines are posted under its ledger account id, not a code.
    const code = (account.ledgerAccount ?? "").trim() || account.code.trim();
    if (code === "") continue;
    const amount = balance.get(code) ?? 0;
    if (amount === 0) continue;
    const type = account.type.toLowerCase();
    const row = (value: number): AccountAmount => ({ code, name: account.name, amount: value as Cents });
    if (/non-?current liab|term liab|long.?term/.test(type)) nonCurrentLiabilities.push(row(-amount));
    else if (/liabilit|payable/.test(type)) currentLiabilities.push(row(-amount));
    else if (/fixed|non-?current|depreciable/.test(type) && /asset/.test(type)) fixedAssets.push(row(amount));
    else if (/asset|bank|receivable|inventory|prepay/.test(type)) currentAssets.push(row(amount));
  }
  const totalIncome = sum(income);
  const totalExpenses = sum(expenses);
  const totalAssets = (sum(currentAssets) + sum(fixedAssets)) as Cents;
  const totalLiabilities = (sum(currentLiabilities) + sum(nonCurrentLiabilities)) as Cents;
  return {
    from: options.from,
    to: options.to,
    income,
    expenses,
    totalIncome,
    totalExpenses,
    surplus: (totalIncome - totalExpenses) as Cents,
    currentAssets,
    fixedAssets,
    currentLiabilities,
    nonCurrentLiabilities,
    totalAssets,
    totalLiabilities,
    netAssets: (totalAssets - totalLiabilities) as Cents,
  };
}

/** Operating payments on the cash basis, as near as the books show: the year's expenses less depreciation. */
export function operatingPaymentsFrom(expenses: readonly AccountAmount[]): Cents {
  return expenses.filter((e) => !/depreciation|amortisation/i.test(e.name)).reduce((s, e) => s + e.amount, 0) as Cents;
}

/** Current assets at a date, from the books. */
export function currentAssetsAt(statements: SmallSocietyStatements): Cents {
  return sum(statements.currentAssets);
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function dateSaid(date: IsoDate): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d} ${months[m - 1] ?? ""} ${y}`;
}

function money(cents: number): string {
  const text = (Math.abs(cents) / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `(${text})` : text;
}

/** The statements as a page to print or save as a PDF, with a line for each of two committee members to sign. */
export function smallSocietyReportHtml(options: {
  name: string;
  statements: SmallSocietyStatements;
  /** Mortgages, charges and other security interests over its property, as the society states them. */
  securityInterests: string;
  signers: readonly [string, string];
  approvedOn?: IsoDate | undefined;
}): string {
  const s = options.statements;
  const table = (rows: readonly AccountAmount[], totalLabel: string, total: number): string =>
    `<table>${rows.map((r) => `<tr><td>${escape(r.name)}</td><td class="n">${money(r.amount)}</td></tr>`).join("")}<tr class="t"><td>${escape(totalLabel)}</td><td class="n">${money(total)}</td></tr></table>`;
  const group = (title: string, rows: readonly AccountAmount[]): string =>
    rows.length === 0 ? "" : `<h4>${escape(title)}</h4>${table(rows, `Total ${title.toLowerCase()}`, sum(rows))}`;
  const security = options.securityInterests.trim();
  return `<!doctype html>
<html lang="en-NZ">
<head>
<meta charset="utf-8">
<title>${escape(options.name)}: financial statements for the year ended ${escape(dateSaid(s.to))}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; max-width: 44rem; margin: 2rem auto; padding: 0 1rem; color: #111; }
  h1 { font-size: 1.5rem; margin: 0 0 0.2rem; }
  h2 { font-size: 1.15rem; margin: 2rem 0 0.4rem; border-bottom: 1px solid #111; }
  h4 { margin: 1rem 0 0.2rem; font-size: 1rem; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 0.2rem 0; border-bottom: 1px solid #ddd; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; width: 9rem; }
  tr.t td { font-weight: 700; border-top: 1px solid #111; border-bottom: 2px solid #111; }
  .sign { display: flex; gap: 3rem; margin-top: 3rem; }
  .sign div { flex: 1; }
  .line { border-top: 1px solid #111; margin-bottom: 0.2rem; }
  .small { font-size: 0.85rem; color: #333; }
</style>
</head>
<body>
<h1>${escape(options.name)}</h1>
<p>Financial statements for the year ended ${escape(dateSaid(s.to))}</p>
<p class="small">Prepared to the minimum requirements for a small incorporated society.</p>

<h2>Income and expenditure for the year</h2>
${group("Income", s.income)}
${group("Expenditure", s.expenses)}
<table><tr class="t"><td>${s.surplus >= 0 ? "Surplus" : "Deficit"} for the year</td><td class="n">${money(s.surplus)}</td></tr></table>

<h2>Assets and liabilities at ${escape(dateSaid(s.to))}</h2>
${group("Current assets", s.currentAssets)}
${group("Non-current assets", s.fixedAssets)}
<table><tr class="t"><td>Total assets</td><td class="n">${money(s.totalAssets)}</td></tr></table>
${group("Current liabilities", s.currentLiabilities)}
${group("Non-current liabilities", s.nonCurrentLiabilities)}
<table><tr class="t"><td>Total liabilities</td><td class="n">${money(s.totalLiabilities)}</td></tr></table>
<table><tr class="t"><td>Net assets (accumulated funds)</td><td class="n">${money(s.netAssets)}</td></tr></table>

<h2>Mortgages, charges and other security interests</h2>
<p>${security === "" ? "There were no mortgages, charges or other security interests over any property of the society at the end of the year." : escape(security).replace(/\n/g, "<br>")}</p>

<div class="sign">
  <div><div class="line"></div>${escape(options.signers[0])}<br><span class="small">Committee member</span></div>
  <div><div class="line"></div>${escape(options.signers[1])}<br><span class="small">Committee member</span></div>
</div>
<p class="small">${options.approvedOn !== undefined ? `Approved ${escape(dateSaid(options.approvedOn))}.` : "Date approved: ____________"}</p>
</body>
</html>
`;
}

/** What is wrong with the statements as they stand, in words to act on. */
export function smallSocietyProblems(options: {
  statements: SmallSocietyStatements;
  signers: readonly [string, string];
}): string[] {
  const out: string[] = [];
  const s = options.statements;
  if (options.signers[0].trim() === "" || options.signers[1].trim() === "") out.push("Two committee members sign the statements: name them.");
  if (options.signers[0].trim() !== "" && options.signers[0].trim().toLowerCase() === options.signers[1].trim().toLowerCase()) out.push("The two signatures must be from two different committee members.");
  if (s.income.length === 0 && s.expenses.length === 0) out.push("No income or expenditure was recorded in this year.");
  return out;
}
