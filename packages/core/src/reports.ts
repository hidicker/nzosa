import type { Cents } from "./money.js";
import type { DateRange } from "./dates.js";
import { inRange } from "./dates.js";
import type { Account } from "./chart.js";
import type { GstClassification } from "./gst.js";
import type { Transaction } from "./types.js";
import type { Journal, JournalLine } from "./journals.js";

/**
 * Profit and loss from bank data.
 *
 * Two things separate this from the statement an accountant signs, and both
 * are stated rather than papered over:
 *
 *  * It is **cash**. A sale is counted when the money arrives, not when the
 *    invoice is raised. Receivables, payables and accruals move figures
 *    between years and none of them exist in a bank feed.
 *
 *  * It has **no non-cash entries**. Depreciation, disposals and year-end
 *    journals are decisions taken over the accounts, not payments, so nothing
 *    here can produce them.
 *
 * What it can do exactly is the part that comes from money moving, and that is
 * most of a small business's profit. Where it agrees with a signed statement,
 * it agrees to the cent.
 *
 * Figures are **GST-exclusive**, because that is what a profit figure means:
 * GST collected is not income and GST paid is not an expense. The classifier
 * already knows each line's treatment, so the tax is removed line by line
 * rather than by dividing a total.
 */

export interface ReportLine {
  /** The account this is coded to. */
  code: string;
  /** Signed, GST-inclusive, as the bank moved it. */
  gross: Cents;
  /** The GST within `gross`, signed the same way. */
  gst: Cents;
  /** `gross` less `gst`: what reaches the profit figure. */
  net: Cents;
  count: number;
}

export type ReportSection = "income" | "expenses" | "unclassified";

export interface ProfitAndLoss {
  period: DateRange;
  income: ReportLine[];
  expenses: ReportLine[];
  /**
   * Codes that are neither, or not known to be either.
   *
   * Transfers between your own accounts, drawings, loan principal and anything
   * with no account type belong here. They are listed rather than dropped: a
   * profit figure that quietly excludes things is one nobody can check.
   */
  unclassified: ReportLine[];
  totalIncome: Cents;
  totalExpenses: Cents;
  netProfit: Cents;
  /** Transactions in the period that carry no code at all. */
  uncoded: { count: number; gross: Cents };
}

export interface ProfitAndLossOptions {
  period: DateRange;
  /** What each transaction is coded to, or null when nothing codes it. */
  codeOf: (transaction: Transaction) => string | null;
  /** How each transaction is treated for GST, so the tax can be removed. */
  classify: (transaction: Transaction) => GstClassification;
  /** Restrict to these bank accounts. Empty means all of them. */
  accounts?: readonly string[];
  /**
   * Which codes belong to the entity being reported on.
   *
   * Returning true for everything reports the lot; the entity model narrows it
   * to one set of books.
   */
  includeCode?: (code: string) => boolean;
  /**
   * Report what actually moved, GST and all, rather than what reaches profit.
   *
   * A registered business's profit is net of GST, because the tax is somebody
   * else's money passing through -- that is the default and the right answer
   * for a return. It is not the right answer for every question: an entity
   * that is not registered bears the GST as a real cost, and "what left the
   * bank" is sometimes simply what is being asked.
   */
  includeGst?: boolean;
  /** Account types by code, from the chart, to tell income from expense. */
  sectionOf?: (code: string) => ReportSection | null;
}

/** Account types a chart uses, mapped to where they belong on a P&L. */
const SECTION_BY_TYPE: Record<string, ReportSection> = {
  revenue: "income",
  sales: "income",
  "other income": "income",
  "direct costs": "expenses",
  expense: "expenses",
  overhead: "expenses",
  "depreciation": "expenses",
};

/** Where an account type belongs, or null when it is a balance-sheet account. */
export function sectionForType(type: string): ReportSection | null {
  const key = type.trim().toLowerCase();
  return SECTION_BY_TYPE[key] ?? null;
}

/**
 * Balance-sheet types, named so that "not on the profit and loss" can be
 * told apart from "nobody has said what this is".
 *
 * Both answer null to `sectionForType`, and the chart screen coloured them
 * the same amber, so Accounts Receivable, Prepayments and Inventory were
 * flagged as needing attention for the crime of being assets. They belong on
 * the balance sheet, which is a fact about them and not a job left undone.
 * What genuinely needs attention is an account whose type is blank or a word
 * nothing recognises, because no report can place it at all.
 */
const BALANCE_SHEET_TYPES = new Set([
  "bank",
  "current asset",
  "fixed asset",
  "non-current asset",
  "noncurrent asset",
  "inventory",
  "prepayment",
  "accounts receivable",
  "accounts payable",
  "current liability",
  "liability",
  "non-current liability",
  "noncurrent liability",
  "term liability",
  "equity",
  "retained earnings",
  /*
   * The accounts an accounting system makes for itself.
   *
   * Every chart exported from one carries a handful: a GST control account, a
   * place for unpaid expense claims, somewhere for historical adjustments and
   * for rounding, a holding account for tracked transfers. Nobody creates
   * them and nobody codes to them by choice, and they were all being flagged
   * amber as types nothing could place -- five accounts in every chart,
   * telling the same person the same non-news every time they opened the
   * page. They belong on the balance sheet, which is where they are now.
   */
  "gst",
  "unpaid expense claims",
  "historical",
  "rounding",
  "tracking",
]);

/** Whether a type is one we can place -- on the P&L or on the balance sheet. */
export function isKnownType(type: string): boolean {
  const key = type.trim().toLowerCase();
  return key in SECTION_BY_TYPE || BALANCE_SHEET_TYPES.has(key);
}

/** Build a `sectionOf` from a chart, keyed by however the codes are labelled. */
export function sectionsFromChart(
  chart: readonly Account[],
  labelOf: (account: Account) => string,
): (code: string) => ReportSection | null {
  const byLabel = new Map<string, ReportSection | null>();
  for (const account of chart) byLabel.set(labelOf(account), sectionForType(account.type));
  return (code) => byLabel.get(code) ?? null;
}

/** The GST inside one amount, given how the line is treated. */
export function gstWithin(amount: Cents, classification: GstClassification): Cents {
  if (classification.side === "imports") return amount;
  if (classification.treatment !== "standard") return 0;
  if (classification.side === "none") return 0;
  return Math.round((amount * 3) / 23);
}

export function profitAndLoss(
  transactions: readonly Transaction[],
  options: ProfitAndLossOptions,
): ProfitAndLoss {
  const accounts = options.accounts ?? [];
  const includeCode = options.includeCode ?? (() => true);
  const sectionOf = options.sectionOf ?? (() => null);

  const lines = new Map<string, ReportLine>();
  let uncodedCount = 0;
  let uncodedGross = 0;

  for (const transaction of transactions) {
    if (!inRange(transaction.date, options.period)) continue;
    if (accounts.length > 0 && !accounts.includes(transaction.account)) continue;

    const code = options.codeOf(transaction);
    if (code === null) {
      uncodedCount += 1;
      uncodedGross += transaction.amount;
      continue;
    }
    if (!includeCode(code)) continue;

    const classification = options.classify(transaction);
    const gst = gstWithin(transaction.amount, classification);
    // Half-deductible entertainment reaches the profit figure at half, which is
    // the whole reason the percentage is carried on the classification.
    const percent = classification.deductiblePercent ?? 100;
    const net =
      percent === 100
        ? transaction.amount - gst
        : Math.round(((transaction.amount - gst) * percent) / 100);

    const existing = lines.get(code) ?? { code, gross: 0, gst: 0, net: 0, count: 0 };
    existing.gross += transaction.amount;
    existing.gst += gst;
    existing.net += net;
    existing.count += 1;
    lines.set(code, existing);
  }

  // Including GST is the same report read from the gross rather than the net,
  // so it is done once here and everything downstream -- sections, totals, the
  // profit figure -- follows without knowing.
  if (options.includeGst === true) {
    for (const line of lines.values()) line.net = line.gross;
  }

  const income: ReportLine[] = [];
  const expenses: ReportLine[] = [];
  const unclassified: ReportLine[] = [];

  for (const line of lines.values()) {
    const section = sectionOf(line.code);
    if (section === "income") income.push(line);
    else if (section === "expenses") expenses.push(line);
    else unclassified.push(line);
  }

  const by = (a: ReportLine, b: ReportLine) => Math.abs(b.net) - Math.abs(a.net);
  income.sort(by);
  expenses.sort(by);
  unclassified.sort(by);

  // Income arrives positive and expenses leave negative. A profit figure reads
  // better with both as magnitudes, so expenses are flipped here and the sign
  // convention stated rather than left for the reader to work out.
  const totalIncome = income.reduce((sum, line) => sum + line.net, 0);
  const totalExpenses = expenses.reduce((sum, line) => sum - line.net, 0);

  return {
    period: options.period,
    income,
    expenses,
    unclassified,
    totalIncome,
    totalExpenses,
    netProfit: totalIncome - totalExpenses,
    uncoded: { count: uncodedCount, gross: uncodedGross },
  };
}

/** Render a profit and loss as CSV. */
export function formatProfitAndLoss(
  report: ProfitAndLoss,
  title: string,
  /**
   * The line under the title saying how the figures were arrived at.
   *
   * It used to be fixed text, which was fine while there was one basis and one
   * treatment of GST. There are now three bases and a choice about the tax, so
   * a fixed line could state the opposite of what the file below it contains.
   */
  note = "Cash basis, GST exclusive. No depreciation or year-end journals.",
): string {
  const money = (cents: Cents): string => (cents / 100).toFixed(2);
  const rows: string[][] = [
    [title],
    [`For the period ${report.period.from} to ${report.period.to}`],
    [note],
    [],
    ["Section", "Account", "Transactions", "Gross", "GST", "Net"],
  ];

  for (const line of report.income) {
    rows.push(["Income", line.code, String(line.count), money(line.gross), money(line.gst), money(line.net)]);
  }
  rows.push(["", "Total Income", "", "", "", money(report.totalIncome)]);
  rows.push([]);

  for (const line of report.expenses) {
    rows.push(["Expenses", line.code, String(line.count), money(line.gross), money(line.gst), money(-line.net)]);
  }
  rows.push(["", "Total Expenses", "", "", "", money(report.totalExpenses)]);
  rows.push([]);
  rows.push(["", "Net Profit", "", "", "", money(report.netProfit)]);

  if (report.unclassified.length > 0) {
    rows.push([]);
    rows.push(["Not in the profit figure — transfers, drawings, loans, or no account type set"]);
    for (const line of report.unclassified) {
      rows.push(["Unclassified", line.code, String(line.count), money(line.gross), money(line.gst), money(line.net)]);
    }
  }
  if (report.uncoded.count > 0) {
    rows.push([]);
    rows.push([`${report.uncoded.count} transactions in this period are not coded at all`,
               "", "", money(report.uncoded.gross)]);
  }

  return rows
    .map((row) => row.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(","))
    .join("\r\n") + "\r\n";
}

/**
 * One entity's result as it reaches one owner's tax return.
 *
 * A jointly owned rental is not the owner's income in full: each returns their
 * share. The share is applied to income and expenses separately rather than to
 * the net, because a return asks for both — and because halving a net figure
 * loses the deductions, which is the number that carries forward when a
 * residential property makes a loss.
 */
export interface OwnerShare {
  entity: string;
  kind: string;
  /** Percentage this owner holds, 0 to 100. */
  percent: number;
  income: Cents;
  expenses: Cents;
  net: Cents;
}

export interface OwnerSummary {
  owner: string;
  shares: OwnerShare[];
  /** Residential rental, which New Zealand ring-fences. */
  residentialIncome: Cents;
  residentialExpenses: Cents;
  residentialNet: Cents;
  /** Everything else: commercial rent and trading income. */
  otherIncome: Cents;
  otherExpenses: Cents;
  otherNet: Cents;
}

/** Apportion entity results to one owner. */
export function summariseForOwner(
  owner: string,
  entries: readonly { entity: string; kind: string; percent: number; report: ProfitAndLoss }[],
): OwnerSummary {
  const shares: OwnerShare[] = [];
  let residentialIncome = 0;
  let residentialExpenses = 0;
  let otherIncome = 0;
  let otherExpenses = 0;

  for (const entry of entries) {
    if (entry.percent <= 0) continue;
    const fraction = entry.percent / 100;
    const income = Math.round(entry.report.totalIncome * fraction);
    const expenses = Math.round(entry.report.totalExpenses * fraction);
    shares.push({
      entity: entry.entity,
      kind: entry.kind,
      percent: entry.percent,
      income,
      expenses,
      net: income - expenses,
    });
    if (entry.kind === "residential") {
      residentialIncome += income;
      residentialExpenses += expenses;
    } else {
      otherIncome += income;
      otherExpenses += expenses;
    }
  }

  return {
    owner,
    shares,
    residentialIncome,
    residentialExpenses,
    residentialNet: residentialIncome - residentialExpenses,
    otherIncome,
    otherExpenses,
    otherNet: otherIncome - otherExpenses,
  };
}

/** Render an owner summary as CSV. */
export function formatOwnerSummary(summary: OwnerSummary, year: number): string {
  const money = (cents: Cents): string => (cents / 100).toFixed(2);
  const rows: string[][] = [
    [`${summary.owner} — rental income, FY${year}`],
    ["Cash basis, GST exclusive. Shares applied to income and expenses separately."],
    [],
    ["Property", "Kind", "Share %", "Income", "Expenses", "Net"],
  ];
  for (const share of summary.shares) {
    rows.push([
      share.entity, share.kind, String(share.percent),
      money(share.income), money(share.expenses), money(share.net),
    ]);
  }
  rows.push([]);
  rows.push(["Residential total", "", "",
    money(summary.residentialIncome), money(summary.residentialExpenses), money(summary.residentialNet)]);
  rows.push(["Other rents and business", "", "",
    money(summary.otherIncome), money(summary.otherExpenses), money(summary.otherNet)]);

  return rows
    .map((row) => row.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(","))
    .join("\r\n") + "\r\n";
}

/**
 * Income that never touches these bank accounts.
 *
 * Interest, dividends and PIE income from KiwiSaver and share platforms are
 * paid and taxed elsewhere, often reinvested without ever arriving. They belong
 * on a return all the same, so they are recorded by hand rather than derived —
 * and kept apart from anything computed, so the two are never confused.
 */
export interface TaxExtra {
  /** Whose return this belongs on. Matches an entity owner's name. */
  owner: string;
  /** Financial year, labelled by the year it ends in. */
  year: number;
  category: TaxExtraCategory;
  /** Who paid it, e.g. `BANK OF NEW ZEALAND`, `SHARESIES NOMINEE LIMITED`. */
  payer: string;
  /** Gross amount before any tax was withheld. */
  gross: Cents;
  /** RWT, imputation or PIE tax credits attached to it. */
  credits: Cents;
  note?: string;
}

export type TaxExtraCategory = "interest" | "dividends" | "pie" | "salary" | "other";

export const TAX_EXTRA_CATEGORIES: readonly { value: TaxExtraCategory; label: string }[] = [
  { value: "interest", label: "Interest" },
  { value: "dividends", label: "Dividends" },
  { value: "pie", label: "PIE income (KiwiSaver, funds)" },
  { value: "salary", label: "Salary or wages" },
  { value: "other", label: "Other income" },
];

/** Totals for one person's non-bank income in a year. */
export function totalExtras(
  extras: readonly TaxExtra[],
  owner: string,
  year: number,
): { gross: Cents; credits: Cents; byCategory: Map<TaxExtraCategory, Cents> } {
  const byCategory = new Map<TaxExtraCategory, Cents>();
  let gross = 0;
  let credits = 0;
  for (const extra of extras) {
    if (extra.owner !== owner || extra.year !== year) continue;
    gross += extra.gross;
    credits += extra.credits;
    byCategory.set(extra.category, (byCategory.get(extra.category) ?? 0) + extra.gross);
  }
  return { gross, credits, byCategory };
}

/**
 * Profit and loss on an accrual basis, from a general ledger.
 *
 * Bank data cannot do this. A sale counts when the invoice is raised and a cost
 * when the bill arrives, and neither event moves money — so an accrual figure
 * needs the ledger where those entries live, not the statement where their
 * payments eventually appear.
 *
 * What it buys is everything the cash basis structurally cannot reach:
 * receivables and payables, and the year-end journals that carry depreciation.
 * Against a signed statement it does not approximate; it agrees.
 *
 * Journal amounts are already GST-exclusive: the tax sits in its own control
 * account, which is not income or expense and so never reaches this report.
 * The gross is still recoverable, because a line this app posted carries the
 * figure its tax was worked out from. A ledger read from somebody else's file
 * carries no such thing, and there `gross` equals `net`.
 */
export interface AccrualOptions {
  period: DateRange;
  /** Where each account belongs on the report. */
  sectionOf: (code: string) => ReportSection | null;
  /** Which accounts belong to the entity being reported on. */
  includeCode?: (code: string) => boolean;
  /**
   * Report what actually moved, GST and all, rather than what reaches profit.
   *
   * A registered business's profit is net of GST, because the tax is somebody
   * else's money passing through -- that is the default and the right answer
   * for a return. It is not the right answer for every question: an entity
   * that is not registered bears the GST as a real cost, and "what left the
   * bank" is sometimes simply what is being asked.
   */
  includeGst?: boolean;
  /** How a journal line's account maps to the name our coding uses. */
  labelOf: (line: JournalLine) => string;
}

export function accrualProfitAndLoss(
  journals: readonly Journal[],
  options: AccrualOptions,
): ProfitAndLoss {
  const includeCode = options.includeCode ?? (() => true);
  const lines = new Map<string, ReportLine>();

  for (const journal of journals) {
    if (!inRange(journal.date, options.period)) continue;
    for (const line of journal.lines) {
      const code = options.labelOf(line);
      if (code === "" || !includeCode(code)) continue;

      // A ledger credits income and debits expenses; a profit and loss reads
      // the other way round, so the sign is flipped once, here.
      const net = -line.amount;

      // Journal lines are already net: the tax sits on its own line in the GST
      // account, which is not income or expense and so never reaches here. The
      // gross is recoverable because a taxed line carries the figure the tax
      // was worked out from.
      // Not negated, unlike the amount above it. A line's amount is a debit or
      // credit and has to be turned round to read as a profit and loss; its
      // taxBase is the transaction it came from, which is already signed the
      // way this report reads -- money in positive, money out negative.
      const gross = line.taxBase ?? net;

      const existing = lines.get(code) ?? { code, gross: 0, gst: 0, net: 0, count: 0 };
      existing.gross += gross;
      existing.gst += gross - net;
      existing.net += net;
      existing.count += 1;
      lines.set(code, existing);
    }
  }

  // Including GST is the same report read from the gross rather than the net,
  // so it is done once here and everything downstream -- sections, totals, the
  // profit figure -- follows without knowing.
  if (options.includeGst === true) {
    for (const line of lines.values()) line.net = line.gross;
  }

  const income: ReportLine[] = [];
  const expenses: ReportLine[] = [];
  const unclassified: ReportLine[] = [];
  for (const line of lines.values()) {
    const section = options.sectionOf(line.code);
    if (section === "income") income.push(line);
    else if (section === "expenses") expenses.push(line);
    else unclassified.push(line);
  }

  const by = (a: ReportLine, b: ReportLine) => Math.abs(b.net) - Math.abs(a.net);
  income.sort(by);
  expenses.sort(by);
  unclassified.sort(by);

  const totalIncome = income.reduce((sum, line) => sum + line.net, 0);
  const totalExpenses = expenses.reduce((sum, line) => sum - line.net, 0);

  return {
    period: options.period,
    income,
    expenses,
    unclassified,
    totalIncome,
    totalExpenses,
    netProfit: totalIncome - totalExpenses,
    uncoded: { count: 0, gross: 0 },
  };
}
