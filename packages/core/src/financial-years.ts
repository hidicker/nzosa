import { computeBalanceSheet } from "./balance-sheet.js";
import type { OpeningBalances } from "./balance-sheet.js";
import { financialYearOf } from "./dates.js";
import type { IsoDate } from "./dates.js";
import type { Cents } from "./money.js";
import type { PostedJournal } from "./posting.js";
import type { Account } from "./chart.js";
import type { Transaction } from "./types.js";

/**
 * Where every account stood at each year end, from whatever is known.
 *
 * Three sources, in order of authority, because they disagree and the order
 * decides which is believed:
 *
 *  1. **Balances imported per year.** A trial balance export carries a column
 *     per year end, and those are somebody's signed figures. Nothing derived
 *     should overwrite them.
 *  2. **The opening balances in force.** The position the ledger opens from.
 *  3. **Rolled forward.** For every later year the transactions reach, the
 *     balance sheet computed to that year end.
 *
 * A year covered by (1) or (2) is never recomputed by (3): an imported figure
 * is evidence and a derived one is arithmetic over whatever has been coded so
 * far, which part way through a year is not the same thing at all.
 */
export interface FinancialYearBalances {
  year: number;
  asAt: IsoDate;
  /** Debit positive, credit negative, keyed by account code. */
  accounts: Record<string, Cents>;
  source?: string;
  /** True where these came from an import rather than from the postings. */
  isOpening: boolean;
  editable: boolean;
}

export interface FinancialYearBalancesOptions {
  openingBalances?: OpeningBalances;
  transactions: readonly Transaction[];
  chart: readonly Account[];
  journals: readonly PostedJournal[];
}

/**
 * A year end stated as the first of April is the *opening* of that year.
 *
 * A trial balance column headed 1 April 2025 is the position the 2026 year
 * begins from, not a position within it, so it labels the year before the one
 * the ordinary rule would give.
 */
function yearOfBalanceDate(date: IsoDate): number {
  if (date.endsWith("-04-01")) return Number(date.slice(0, 4));
  return financialYearOf(date);
}

export function financialYearBalances(
  options: FinancialYearBalancesOptions,
): FinancialYearBalances[] {
  const { openingBalances: held, transactions, chart, journals } = options;
  const result = new Map<number, FinancialYearBalances>();

  // 1. Imported columns, one per year end.
  if (held?.byDate) {
    for (const [date, accounts] of Object.entries(held.byDate)) {
      if (Object.keys(accounts).length === 0) continue;
      const year = yearOfBalanceDate(date);
      result.set(year, {
        year,
        asAt: `${year}-03-31`,
        accounts,
        ...(held.source !== undefined ? { source: held.source } : {}),
        isOpening: true,
        editable: true,
      });
    }
  }

  // 2. The opening balances in force, which win over an imported column for
  //    the same year: they are what the ledger is actually opening from.
  if (held && Object.keys(held.accounts).length > 0) {
    const year = yearOfBalanceDate(held.asAt);
    result.set(year, {
      year,
      asAt: `${year}-03-31`,
      accounts: held.accounts,
      ...(held.source !== undefined ? { source: held.source } : {}),
      isOpening: true,
      editable: true,
    });
  }

  // 3. Rolled forward for every later year the transactions reach.
  const openingYear = held ? yearOfBalanceDate(held.asAt) : null;
  const years = [...new Set(transactions.map((t) => financialYearOf(t.date)))].sort((a, b) => a - b);

  for (const year of years) {
    if (openingYear !== null && year <= openingYear && result.has(year)) continue;

    const asAt: IsoDate = `${year}-03-31`;
    const sheet = computeBalanceSheet({
      asAt,
      ...(held ? { openingBalances: held } : {}),
      journals,
      chart,
    });

    // Presented signs flipped back to posting signs: a balance sheet is
    // written with liabilities positive, and these are balances, not a report.
    const accounts: Record<string, Cents> = {};
    for (const line of [...sheet.currentAssets.lines, ...sheet.nonCurrentAssets.lines]) {
      if (line.closing !== 0) accounts[line.code] = line.closing;
    }
    for (const line of [...sheet.currentLiabilities.lines, ...sheet.nonCurrentLiabilities.lines]) {
      if (line.closing !== 0) accounts[line.code] = -line.closing;
    }
    for (const line of sheet.equity.lines) {
      if (line.code !== "" && line.closing !== 0) accounts[line.code] = -line.closing;
    }

    // The year's own profit has not been closed off to retained earnings yet,
    // so it is added there: without it the balances do not add up to a
    // position, they add up to a position less this year's trading.
    if (sheet.profitForPeriod !== 0) {
      const retained =
        chart.find((a) => a.type === "Equity" && /retained/i.test(a.name))?.code ?? "960";
      accounts[retained] = (accounts[retained] ?? 0) - sheet.profitForPeriod;
    }

    if (Object.keys(accounts).length > 0) {
      result.set(year, { year, asAt, accounts, isOpening: false, editable: false });
    }
  }

  return [...result.values()].sort((a, b) => a.year - b.year);
}
