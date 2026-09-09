import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import { parseAmount } from "./money.js";
import { parseCsvRecords, findHeaderRow } from "./csv.js";
import type { OpeningBalances } from "./balance-sheet.js";

/**
 * Reading a trial balance, which is the right source for opening balances.
 *
 * A printed balance sheet is not. It is stated in whole dollars, so its
 * components round one way and its totals another, and a set of figures read
 * off it cannot be made to balance without inventing an amount to absorb the
 * difference. Doing exactly that on one real set of books hid five errors: the
 * fixed asset account held net book value rather than cost, its accumulated
 * depreciation was missing, a whole vehicle was missing, the shareholder loan
 * was shown net of drawings, and three accounts were out by cents.
 *
 * A trial balance has none of those problems. Every account appears, cost and
 * accumulated depreciation stand apart as the ledger holds them, and the cents
 * are there, so the figures balance on their own.
 */

export interface TrialBalanceAccount {
  /** Chart code. Empty for bank accounts, which the export leaves uncoded. */
  code: string;
  name: string;
  /** The chart's own type, e.g. `Fixed Asset`. */
  type: string;
  /** `Asset`, `Liability`, `Equity`, `Revenue` or `Expense`. */
  klass: string;
  /** Balance at each date the report carries, debit positive. */
  byDate: Record<string, Cents>;
}

export interface TrialBalance {
  /** The report's own date, from its heading. */
  asAt: IsoDate | null;
  /** Every balance column, in the order the report gives them. */
  dates: string[];
  accounts: TrialBalanceAccount[];
  problems: { message: string; line: number }[];
}

const REQUIRED = ["Account", "Account Type"];

/** `31 Mar 2025` and `As at 31 March 2026` both become `2025-03-31`. */
function isoFrom(text: string): IsoDate | null {
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const match = /(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/.exec(text);
  if (!match) return null;
  const month = months[(match[2] ?? "").slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  return `${match[3]}-${month}-${(match[1] ?? "").padStart(2, "0")}`;
}

/**
 * Read a trial balance export.
 *
 * Xero writes one row per account and a column per balance date, with the
 * report's own date first and prior years after it. Movement columns -- debit
 * and credit for the month or the year -- are not balances and are skipped:
 * taking one for a balance would state a year's turnover as an opening figure.
 */
export function parseTrialBalance(text: string): TrialBalance {
  const records = parseCsvRecords(text);
  const header = findHeaderRow(records, REQUIRED);
  if (!header) {
    return {
      asAt: null,
      dates: [],
      accounts: [],
      problems: [{ message: "Not a trial balance: an Account column is needed.", line: 0 }],
    };
  }

  const heading = records
    .slice(0, header.index)
    .map((r) => (r.fields ?? []).join(" "))
    .join(" ");

  const columns = records[header.index]?.fields ?? [];
  const at = (name: string): number => columns.findIndex((c) => c.trim() === name);
  const codeAt = at("Account Code");
  const nameAt = at("Account");
  const typeAt = at("Account Type");
  const classAt = at("Account Class");

  // A balance column is one headed by a date. Everything else on the row is a
  // movement, a label, or a running total, and none of those is a balance.
  const dateColumns: { index: number; label: string; iso: IsoDate }[] = [];
  columns.forEach((label, index) => {
    const iso = isoFrom(label);
    if (iso !== null) dateColumns.push({ index, label: label.trim(), iso });
  });

  const accounts: TrialBalanceAccount[] = [];
  const problems: { message: string; line: number }[] = [];

  for (let i = header.index + 1; i < records.length; i += 1) {
    const fields = records[i]?.fields ?? [];
    const name = (fields[nameAt] ?? "").trim();
    if (name === "") continue;

    const byDate: Record<string, Cents> = {};
    for (const column of dateColumns) {
      const raw = (fields[column.index] ?? "").trim();
      if (raw === "") continue;
      const cents = parseAmount(raw);
      if (cents === null) continue;
      byDate[column.iso] = cents;
    }
    if (Object.keys(byDate).length === 0) continue;

    accounts.push({
      code: (fields[codeAt] ?? "").trim(),
      name,
      type: (fields[typeAt] ?? "").trim(),
      klass: (fields[classAt] ?? "").trim(),
      byDate,
    });
  }

  if (accounts.length === 0) {
    problems.push({ message: "No accounts with balances were found.", line: header.index });
  }

  return {
    asAt: isoFrom(heading),
    dates: dateColumns.map((c) => c.iso),
    accounts,
    problems,
  };
}

export interface OpeningBalancesFromTrialBalance {
  balances: OpeningBalances;
  /**
   * The figure retained earnings had to be for the rest to balance.
   *
   * Named rather than folded in silently. A trial balance taken at a year end
   * shows that year's revenue and expenses as well as the balances, and those
   * close off into retained earnings when the year does -- so the account is
   * usually absent from the column, and its opening figure is what the balance
   * sheet accounts leave over. Anybody looking at these numbers is entitled to
   * know which one was derived.
   */
  retainedEarnings: Cents;
  /** True when the export already carried a retained earnings figure. */
  retainedEarningsGiven: boolean;
  /** Accounts left out because they are revenue or expense. */
  skipped: string[];
}

/**
 * Turn one column of a trial balance into opening balances.
 *
 * `retainedEarningsCode` is where the balancing figure goes -- 960 in a Xero
 * chart. Revenue and expense accounts are left out: a new year starts them at
 * nothing, and their closing figures are already inside retained earnings.
 */
export function openingBalancesFrom(
  trialBalance: TrialBalance,
  date: IsoDate,
  options: { retainedEarningsCode?: string; bankAccountFor?: (name: string) => string | undefined } = {},
): OpeningBalancesFromTrialBalance {
  const retainedCode = options.retainedEarningsCode ?? "960";
  const accounts: Record<string, Cents> = {};
  const skipped: string[] = [];
  let total = 0;
  let given = false;

  for (const account of trialBalance.accounts) {
    const cents = account.byDate[date];
    if (cents === undefined || cents === 0) continue;

    const klass = account.klass.trim().toLowerCase();
    if (klass === "revenue" || klass === "expense") {
      skipped.push(account.name);
      continue;
    }

    // A bank account has no chart code, and this ledger keys it by the account
    // number rather than by the name the export prints. The caller knows the
    // mapping; without one the name is used, which at least keeps the figure.
    const key =
      account.code !== ""
        ? account.code
        : (options.bankAccountFor?.(account.name) ?? account.name.trim());

    accounts[key] = (accounts[key] ?? 0) + cents;
    total += cents;
    if (account.code === retainedCode) given = true;
  }

  // Whatever is left over is retained earnings, because that is what retained
  // earnings is: everything the company has earned and not distributed. If the
  // export named it too, this adds to that rather than replacing it.
  const balancing = -total;
  if (balancing !== 0) accounts[retainedCode] = (accounts[retainedCode] ?? 0) + balancing;

  return {
    balances: {
      asAt: date,
      source: `Trial balance, ${date} column`,
      accounts,
    },
    retainedEarnings: accounts[retainedCode] ?? 0,
    retainedEarningsGiven: given,
    skipped,
  };
}
