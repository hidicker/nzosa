import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Account } from "./chart.js";
import type { PostedJournal } from "./posting.js";
import type { OpeningBalances } from "./balance-sheet.js";

/**
 * Inland Revenue's IR10, the financial statements summary filed with an IR4.
 *
 * The form is a fixed set of numbered boxes, and every account in a set of
 * books belongs to exactly one of them. Getting that mapping wrong is not a
 * presentation problem: box 2 is sales and box 10 is other income, and a
 * capital gain reported in box 2 is assessable income the company does not owe
 * tax on.
 */

export interface Ir10Box {
  box: number;
  title: string;
  category: "income" | "cogs" | "expenses" | "assets" | "liabilities" | "equity";
  amount: Cents;
  notes?: string;
}

export interface Ir10Summary {
  yearEnding: string;
  boxes: Record<number, Ir10Box>;
  grossProfit: Cents;
  totalIncome: Cents;
  totalExpenses: Cents;
  netProfitBeforeTax: Cents;
  totalCurrentAssets: Cents;
  totalFixedAssets: Cents;
  totalAssets: Cents;
  totalCurrentLiabilities: Cents;
  totalLiabilities: Cents;
  totalEquity: Cents;
}

/** Accounts that can sit on either side, and so cannot be mapped by code alone. */
const TWO_SIDED = new Set(["820"]);

/**
 * Which IR10 box an account belongs to, or null when it belongs to none.
 *
 * `balance` is the account's closing balance, debit positive, and is consulted
 * only for accounts that can fall on either side of the sheet. GST is the one
 * that matters: a company owed a refund holds an asset and a company that owes
 * a return holds a liability, and the same code carries both across a year.
 *
 * The order here is the whole of the correctness. A specific code is checked
 * before any test on the account's type, because a chart calls Sales, Interest
 * Income and Capital Gain on Disposal all "Revenue" -- and a type-first test
 * put every one of them in box 2, reporting interest received and a
 * non-assessable capital gain as sales.
 */
export function ir10BoxForAccount(code: string, type = "", balance: Cents = 0): number | null {
  const c = String(code).trim();
  const digits = /(\d{3,4})/.exec(c)?.[1] ?? c;
  const t = type.trim().toLowerCase();

  // --- Specific codes first, always. ---

  // Income.
  if (digits === "200") return 2; // Sales and/or services
  if (digits === "270") return 7; // Interest received
  if (digits === "260") return 10; // Other income
  if (digits === "300") return 10; // Other income: depreciation recovered
  if (digits === "301") return 10; // Other income: non-assessable capital item

  // Trading.
  if (digits === "310") return 4; // Purchases
  if (digits === "630") return 5; // Closing stock. Opening stock is box 3 and
  // cannot be told from this one by code: it is the same account at a
  // different date, so a caller with both dates supplies box 3 itself.

  // Named expense boxes.
  if (digits === "416") return 13; // Accounting depreciation and amortisation
  if (digits === "433") return 14; // Insurance, excluding ACC levies
  if (digits === "437") return 15; // Interest expenses
  if (digits === "412" || digits === "441") return 16; // Professional and consulting fees
  if (digits === "469") return 18; // Rental, lease and licence payments
  if (digits === "473") return 19; // Repairs and maintenance
  if (digits === "477" || digits === "478") return 22; // Salaries and wages
  if (digits === "413" || digits === "414") return 23; // Contractor payments

  // Income tax is not an IR10 expense: the form works to profit before tax.
  if (digits === "505") return null;

  // Balance sheet, by code.
  if (digits === "610" || digits === "611") return 27; // Accounts receivable
  if (digits === "620" || digits === "625") return 29; // Other current assets
  if (digits === "900") return 35; // Non-current liabilities
  if (digits === "910" || digits === "970" || digits === "980") return 37; // Owners' equity
  if (digits === "960" || digits === "860" || digits === "840") return 38; // Retained earnings

  // Two-sided accounts, decided by where they actually sit.
  if (TWO_SIDED.has(digits) || t === "gst") {
    return balance > 0 ? 29 : 34;
  }

  // --- Then by type, for anything the chart names but this does not. ---

  if (t === "bank") return 28; // Cash and bank balances
  if (t === "accounts receivable") return 27;
  if (t === "accounts payable" || t === "current liability" || t === "unpaid expense claims") return 34;
  if (t === "non-current liability") return 35;
  if (t === "inventory") return 5;
  if (t === "fixed asset") return 31;
  if (t === "current asset") return 29;
  if (t === "retained earnings") return 38;
  if (t === "equity") return 37;
  if (t === "revenue" || t === "sales") return 2;
  if (t === "other income") return 10;
  if (t === "direct costs") return 4;

  // --- Then by code range, for a chart this has never seen. ---

  if (digits.startsWith("7")) return 31; // Fixed assets at book value
  if (digits.startsWith("8")) return 34; // Current liabilities
  if (t === "overhead" || t === "expense" || digits.startsWith("4") || digits.startsWith("5")) {
    return 24; // Other expenses
  }

  return null;
}

/** What each box is called on the form. */
const BOX_TITLES: Record<number, string> = {
  2: "Sales and/or services",
  3: "Opening stock",
  4: "Purchases",
  5: "Closing stock",
  6: "Gross profit",
  7: "Interest received",
  10: "Other income",
  11: "Total income",
  13: "Accounting depreciation and amortisation",
  14: "Insurance",
  15: "Interest expenses",
  16: "Professional and consulting fees",
  18: "Rental, lease and licence payments",
  19: "Repairs and maintenance",
  22: "Salaries and wages paid to employees",
  23: "Contractor and sub-contractor payments",
  24: "Other expenses",
  25: "Total expenses",
  26: "Net profit before tax",
  27: "Accounts receivable (debtors)",
  28: "Cash and bank balances",
  29: "Other current assets",
  31: "Fixed assets",
  34: "Current liabilities",
  35: "Total non-current liabilities",
  37: "Owners' equity / shareholder current account",
  38: "Retained earnings / reserves",
};

const CATEGORY: Record<number, Ir10Box["category"]> = {
  2: "income", 3: "cogs", 4: "cogs", 5: "cogs", 6: "income", 7: "income", 10: "income", 11: "income",
  13: "expenses", 14: "expenses", 15: "expenses", 16: "expenses", 18: "expenses", 19: "expenses",
  22: "expenses", 23: "expenses", 24: "expenses", 25: "expenses", 26: "income",
  27: "assets", 28: "assets", 29: "assets", 31: "assets",
  34: "liabilities", 35: "liabilities", 37: "equity", 38: "equity",
};

/** Boxes the form works out from the others rather than from any account. */
const CALCULATED = new Set([6, 11, 25, 26]);

export interface Ir10Options {
  /** The year being returned, e.g. `2026-03-31`. */
  yearEnding: IsoDate;
  /** The day it opened, e.g. `2025-04-01`. */
  yearStarting: IsoDate;
  journals: readonly PostedJournal[];
  openingBalances?: OpeningBalances;
  chart: readonly Account[];
}

/**
 * Fill in the IR10 from a set of books.
 *
 * Two different kinds of figure go on the same form. The income and expense
 * boxes are a year's movement; the balance sheet boxes are a position on one
 * day. Reading either as the other is how a return ends up reporting a year of
 * sales as a debtor balance, so they are taken from different places here and
 * the code says which is which.
 *
 * Signs follow the form rather than the ledger. Inland Revenue asks for
 * positive figures throughout: income and liabilities are credits in the books
 * and are turned round once, on the way out.
 */
export function ir10Summary(options: Ir10Options): Ir10Summary {
  const { yearEnding, yearStarting, journals, openingBalances, chart } = options;
  const byCode = new Map(chart.map((a) => [a.code, a]));
  const opening = openingBalances?.accounts ?? {};
  const openingAt = openingBalances?.asAt ?? null;

  /** Closing balance and in-year movement for every account, debit positive. */
  const closing = new Map<string, Cents>(Object.entries(opening));
  const movement = new Map<string, Cents>();
  const priorClosing = new Map<string, Cents>(Object.entries(opening));

  for (const journal of journals) {
    if (journal.date > yearEnding) continue;
    if (openingAt !== null && journal.date < openingAt) continue;
    const inYear = journal.date >= yearStarting;
    for (const line of journal.lines) {
      const code = line.accountCode || line.accountName;
      closing.set(code, (closing.get(code) ?? 0) + line.amount);
      if (inYear) movement.set(code, (movement.get(code) ?? 0) + line.amount);
      else priorClosing.set(code, (priorClosing.get(code) ?? 0) + line.amount);
    }
  }

  const boxes: Record<number, Ir10Box> = {};
  const add = (box: number, amount: Cents): void => {
    if (amount === 0 && boxes[box] === undefined) return;
    const held = boxes[box];
    if (held) held.amount += amount;
    else {
      boxes[box] = {
        box,
        title: BOX_TITLES[box] ?? `Box ${box}`,
        category: CATEGORY[box] ?? "expenses",
        amount,
      };
    }
  };

  const codes = new Set<string>([...closing.keys(), ...movement.keys()]);
  for (const code of codes) {
    const account = byCode.get(code);
    // A posting with no chart code is a bank line: this app posts the bank side
    // against the account itself, which carries no code.
    const type = account?.type ?? "Bank";
    const klass = type.trim().toLowerCase();
    const isProfitAndLoss =
      klass === "revenue" || klass === "other income" || klass === "direct costs" ||
      klass === "expense" || klass === "overhead";

    const balance = closing.get(code) ?? 0;
    const box = ir10BoxForAccount(code, type, balance);
    if (box === null) continue;

    if (isProfitAndLoss) {
      // A year's trading. Income is a credit, and the form wants it positive.
      const moved = movement.get(code) ?? 0;
      // Income is a credit and the form wants it positive, so it turns round.
      // Purchases do not: they are a cost, and box 4 is already a positive
      // figure that gross profit subtracts.
      add(box, CATEGORY[box] === "income" ? -moved : moved);
      continue;
    }

    // A position on the day. Assets stay as they are; liabilities and equity
    // are credits and the form wants them positive.
    const owed = CATEGORY[box] === "liabilities" || CATEGORY[box] === "equity";
    add(box, owed ? -balance : balance);
  }

  // Stock is one account read at two dates, which no mapping from a code alone
  // could tell apart.
  const inventory = chart.filter((a) => a.type.trim().toLowerCase() === "inventory");
  for (const account of inventory) {
    const open = priorClosing.get(account.code) ?? 0;
    const close = closing.get(account.code) ?? 0;
    if (open !== 0) add(3, open);
    if (close !== 0) {
      // Closing stock is set rather than added: the loop above already put the
      // closing balance in box 5 through the inventory type.
      const held = boxes[5];
      if (held) held.amount = close;
      else add(5, close);
    }
  }

  const amount = (box: number): Cents => boxes[box]?.amount ?? 0;

  const grossProfit = amount(2) - amount(3) - amount(4) + amount(5);
  const totalIncome = grossProfit + amount(7) + amount(10);
  const totalExpenses = [13, 14, 15, 16, 18, 19, 22, 23, 24].reduce((sum, b) => sum + amount(b), 0);
  const netProfitBeforeTax = totalIncome - totalExpenses;

  for (const [box, value] of [
    [6, grossProfit],
    [11, totalIncome],
    [25, totalExpenses],
    [26, netProfitBeforeTax],
  ] as const) {
    boxes[box] = {
      box,
      title: BOX_TITLES[box] ?? `Box ${box}`,
      category: CATEGORY[box] ?? "income",
      amount: value,
      notes: "Worked out from the boxes above.",
    };
  }

  // Retained earnings at balance date includes the year just traded. The
  // ledger holds the opening figure and the year's result is still sitting in
  // the revenue and expense accounts, because nothing has closed the year off
  // -- so without this, assets exceed liabilities and equity by exactly the
  // profit, and the one arithmetic check the form allows would fail on a set
  // of books that is perfectly correct.
  //
  // Before tax, because that is what these books know: no provision for income
  // tax has been made, and the balance sheet takes the same figure to equity.
  if (netProfitBeforeTax !== 0) add(38, netProfitBeforeTax);

  const totalCurrentAssets = amount(27) + amount(28) + amount(29);
  const totalFixedAssets = amount(31);

  return {
    yearEnding,
    boxes,
    grossProfit,
    totalIncome,
    totalExpenses,
    netProfitBeforeTax,
    totalCurrentAssets,
    totalFixedAssets,
    totalAssets: totalCurrentAssets + totalFixedAssets,
    totalCurrentLiabilities: amount(34),
    totalLiabilities: amount(34) + amount(35),
    totalEquity: amount(37) + amount(38),
  };
}

/** Which boxes the form works out rather than takes from an account. */
export function ir10IsCalculated(box: number): boolean {
  return CALCULATED.has(box);
}
