import type { FixedAsset } from "./assets.js";
import type { OpeningBalances } from "./balance-sheet.js";
import type { Account } from "./chart.js";
import type { IsoDate } from "./dates.js";
import type { Cents } from "./money.js";
import type { PostedJournal } from "./posting.js";

/**
 * Inland Revenue's IR10, the financial statement summary filed with an IR4.
 *
 * The form is a fixed set of numbered boxes, and every account in a set of
 * books belongs to exactly one of them. Getting that mapping wrong is not a
 * presentation problem: box 2 is sales and box 53 is untaxed realised gains,
 * and a capital gain reported as income is income the company does not owe
 * tax on.
 *
 * This follows the form as it is filed now -- boxes 1 to 60, in whole dollars
 * -- and the way a signed return sets the books out on it. It replaced an
 * earlier layout numbered from an older form, which put a capital gain in
 * other income, a shareholder's current account in equity, and every fixed
 * asset in one box; set beside a return an accountant had actually filed, a
 * third of its boxes disagreed.
 */

export interface Ir10Box {
  box: number;
  title: string;
  /** Whole dollars, held in cents: the form is filed in dollars. */
  amount: Cents;
  /** Box 1 is an answer rather than an amount. */
  text?: string;
  /** Printed in bold on the form. */
  total: boolean;
  /** Worked out from other boxes rather than taken from any account. */
  calculated: boolean;
}

export interface Ir10Line {
  box: number;
  title: string;
  /** Printed in bold. */
  total?: boolean;
  /** A rule is drawn under this box. */
  ruleAfter?: boolean;
}

/** The form, box by box, in the order and wording it is printed in. */
export const IR10_LAYOUT: readonly Ir10Line[] = [
  { box: 1, title: "Multiple activity indicator", ruleAfter: true },
  { box: 2, title: "Sales and/or services" },
  { box: 3, title: "Opening stock (including work in progress)" },
  { box: 4, title: "Purchases" },
  { box: 5, title: "Closing stock (including work in progress)" },
  { box: 6, title: "Gross profit", total: true, ruleAfter: true },
  { box: 7, title: "Interest received" },
  { box: 8, title: "Dividends received" },
  { box: 9, title: "Rental, lease and licence income" },
  { box: 10, title: "Other income" },
  { box: 11, title: "Total income", total: true, ruleAfter: true },
  { box: 12, title: "Bad debts" },
  { box: 13, title: "Accounting depreciation and amortisation" },
  { box: 14, title: "Insurance (excluding ACC levies)" },
  { box: 15, title: "Interest expenses" },
  { box: 16, title: "Professional and consulting Fees" },
  { box: 17, title: "Rates" },
  { box: 18, title: "Rental, lease and licence payments" },
  { box: 19, title: "Repairs and maintenance" },
  { box: 20, title: "Research and development" },
  { box: 21, title: "Associated persons' remuneration" },
  { box: 22, title: "Salaries and wages paid to employees" },
  { box: 23, title: "Contractor and sub-contractor payments" },
  { box: 24, title: "Other expenses" },
  { box: 25, title: "Total expenses", total: true, ruleAfter: true },
  { box: 26, title: "Exceptional items" },
  { box: 27, title: "Net profit/loss before tax" },
  { box: 28, title: "Tax adjustments" },
  { box: 29, title: "Current year taxable profit/loss", total: true, ruleAfter: true },
  { box: 30, title: "Accounts receivable (debtors)" },
  { box: 31, title: "Cash and deposits" },
  { box: 32, title: "Other current assets" },
  { box: 33, title: "Vehicles" },
  { box: 34, title: "Plant and machinery" },
  { box: 35, title: "Furniture and fittings" },
  { box: 36, title: "Land" },
  { box: 37, title: "Buildings" },
  { box: 38, title: "Other fixed assets" },
  { box: 39, title: "Intangibles" },
  { box: 40, title: "Shares/ownership interests" },
  { box: 41, title: "Term deposits" },
  { box: 42, title: "Other non-current assets" },
  { box: 43, title: "Total assets", total: true, ruleAfter: true },
  { box: 44, title: "Provisions" },
  { box: 45, title: "Accounts payable (creditors)" },
  { box: 46, title: "Current loans" },
  { box: 47, title: "Other current liabilities" },
  { box: 48, title: "Total current liabilities" },
  { box: 49, title: "Non-current liabilities" },
  { box: 50, title: "Total liabilities", total: true, ruleAfter: true },
  { box: 51, title: "Owners equity" },
  { box: 52, title: "Tax depreciation" },
  { box: 53, title: "Untaxed realised gains/receipts" },
  { box: 54, title: "Additions to fixed assets" },
  { box: 55, title: "Disposals of fixed assets" },
  { box: 56, title: "Dividends paid" },
  { box: 57, title: "Drawings" },
  { box: 58, title: "Current account year end balances" },
  { box: 59, title: "Tax-deductible loss on disposal of fixed assets" },
  { box: 60, title: "Investment boost claimed", ruleAfter: true },
];

/** Income boxes: credits in the books, positive on the form. */
const INCOME = new Set([2, 7, 8, 9, 10]);
/** Liability boxes: credits in the books, positive on the form. */
const LIABILITIES = new Set([44, 45, 46, 47, 49]);
/** Boxes the form works out from the others. */
const CALCULATED = new Set([6, 11, 25, 27, 29, 43, 48, 50, 51]);
const EXPENSES = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
const ASSETS = [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42];

const SHAREHOLDER_CODES = new Set(["910", "970", "980"]);

/**
 * An account that is part of a shareholder's current account.
 *
 * A director's loan, their drawings and the funds they put in are one running
 * balance with the company, which the company owes back while it is in credit.
 */
function shareholderAccount(digits: string, name: string, type: string): boolean {
  if (SHAREHOLDER_CODES.has(digits)) return true;
  if (!type.includes("liability") && type !== "equity") return false;
  return /\b(director|shareholder|drawings?|funds introduced|current account)\b/.test(name);
}

/**
 * Which IR10 box an account belongs to, or null when it belongs to none.
 *
 * `balance` is the account's closing balance, debit positive, and is consulted
 * only for accounts that can fall on either side of the sheet: GST owed or
 * refundable, rounding either way.
 *
 * A specific code is checked before the account's type, because a chart calls
 * Sales, Interest Income and a capital gain all "Revenue"; a type-first test
 * put every one of them in sales. The name decides within a type where a type
 * covers several boxes -- a fixed asset is a vehicle or plant by what it is
 * called, and its accumulated depreciation, named after it, goes with it.
 */
export function ir10BoxForAccount(
  code: string,
  type = "",
  balance: Cents = 0,
  name = "",
): number | null {
  const c = String(code).trim();
  const digits = /(\d{3,4})/.exec(c)?.[1] ?? c;
  const t = type.trim().toLowerCase();
  const n = name.trim().toLowerCase();
  const expenseType =
    t === "expense" || t === "overhead" || t === "depreciation" || t === "direct costs";

  // --- Income. A capital gain is not income at all: the form reports it as an
  // untaxed realised gain, below the line. ---
  if (digits === "301" || /capital gain/.test(n)) return 53;
  // Income tax is not an IR10 expense: the form works to profit before tax.
  if (digits === "505") return null;
  if (expenseType && /income tax/.test(n)) return null;
  if (digits === "200") return 2;
  if (digits === "270" || /interest (income|received)/.test(n)) return 7;
  if (/dividends? (income|received)/.test(n)) return 8;
  if ((t === "revenue" || t === "sales" || t === "other income") && /\b(rent|rental|lease|licen[cs]e)\b/.test(n)) {
    return 9;
  }
  if (digits === "260" || digits === "300") return 10;

  // --- Trading. Stock on hand is a current asset; boxes 3 and 5 read the same
  // account at two dates, which the summary does itself. ---
  if (digits === "310") return 4;
  if (digits === "630" || t === "inventory") return 32;

  // --- Expenses: named boxes by code, then by name within an expense account.
  if (digits === "416") return 13;
  if (digits === "433") return 14;
  if (digits === "437") return 15;
  if (digits === "412" || digits === "441") return 16;
  if (digits === "469") return 18;
  if (digits === "473") return 19;
  if (digits === "477" || digits === "478") return 22;
  if (digits === "413" || digits === "414") return 23;
  if (expenseType) {
    if (/bad debt/.test(n)) return 12;
    if (/depreciation|amortisation/.test(n)) return 13;
    if (/insurance/.test(n) && !/\bacc\b/.test(n)) return 14;
    if (/interest/.test(n)) return 15;
    if (/accounting|legal|consult|professional/.test(n)) return 16;
    if (/\brates\b/.test(n)) return 17;
    if (/\b(rent|lease|licen[cs]e fees?)\b/.test(n)) return 18;
    if (/repairs?|maintenance/.test(n)) return 19;
    if (/research and development|\br&d\b/.test(n)) return 20;
    if (/director'?s? (fees|remuneration)|shareholder salar/.test(n)) return 21;
    if (/salar|wages|kiwisaver/.test(n)) return 22;
    if (/contractor/.test(n)) return 23;
    return t === "direct costs" ? 4 : 24;
  }

  // --- Assets. ---
  if (digits === "610" || digits === "611" || t === "accounts receivable") return 30;
  if (t === "bank") return 31;
  if (digits === "820" || t === "gst") return balance > 0 ? 32 : 47;
  if (digits === "860" || t === "rounding") return balance > 0 ? 32 : 47;
  if (digits === "620" || digits === "625" || t === "current asset" || t === "prepayment") return 32;
  if (t === "fixed asset" || (t === "" && digits.startsWith("7"))) {
    if (/vehicle|motor/.test(n)) return 33;
    if (/plant|machinery|equipment|computer|\btools?\b/.test(n)) return 34;
    if (/furniture|fittings/.test(n)) return 35;
    if (/\bland\b/.test(n)) return 36;
    if (/building/.test(n)) return 37;
    if (/goodwill|intangible|software|trade ?mark|patent/.test(n)) return 39;
    return 38;
  }
  if (t === "non-current asset") {
    if (/\bshares?\b|investment/.test(n)) return 40;
    if (/term deposit/.test(n)) return 41;
    return 42;
  }

  // --- Liabilities. A shareholder's current account first: it can be typed as
  // a loan, a non-current liability or equity, and is none of those here. ---
  if (shareholderAccount(digits, n, t)) return 47;
  if (digits === "800" || t === "accounts payable" || t === "unpaid expense claims") return 45;
  if (t.includes("liability") && /provision/.test(n)) return 44;
  if (t === "current liability" && /\bloan\b/.test(n)) return 46;
  if (digits === "900" || t === "non-current liability" || t === "term liability") return 49;
  if (t === "current liability" || t === "liability") return 47;

  // --- Equity: owners equity is what assets leave once liabilities are met. ---
  if (digits === "960" || digits === "840" || t === "retained earnings" || t === "historical" || t === "equity") {
    return 51;
  }

  // --- A chart this has never seen: by type, then by number. ---
  if (t === "revenue" || t === "sales") return 2;
  if (t === "other income") return 10;
  if (t === "tracking") return null;
  if (digits.startsWith("7")) return 38;
  if (digits.startsWith("8")) return 47;
  if (digits.startsWith("4") || digits.startsWith("5")) return 24;
  return null;
}

export interface Ir10Options {
  /** The year being returned, e.g. `2026-03-31`. */
  yearEnding: IsoDate;
  /** The day it opened, e.g. `2025-04-01`. */
  yearStarting: IsoDate;
  journals: readonly PostedJournal[];
  openingBalances?: OpeningBalances;
  chart: readonly Account[];
  /** The asset register, for the additions and disposals boxes. */
  assets?: readonly FixedAsset[];
  /** What each disposed asset sold for, by asset number. */
  proceeds?: Readonly<Record<string, Cents>>;
  /**
   * Whether shareholder current accounts are liabilities, as a company owes
   * them, or part of the owners' equity, as they are for anyone else. Box 58
   * reports the balance either way. Defaults to a company.
   */
  currentAccountsAsLiabilities?: boolean;
  /** Box 1. Defaults to one activity. */
  multipleActivities?: boolean;
}

export interface Ir10Summary {
  yearEnding: IsoDate;
  yearStarting: IsoDate;
  boxes: Record<number, Ir10Box>;
  /**
   * Every account's closing balance summed, before any rounding.
   *
   * Zero on books that balance. The form cannot fail to balance -- owners
   * equity is the difference between its assets and its liabilities -- so
   * this is the check on the books behind it.
   */
  imbalance: Cents;
  currentAccountsAsLiabilities: boolean;
}

/**
 * Fill in the IR10 from a set of books.
 *
 * The income and expense boxes are a year's movement; the balance sheet boxes
 * are a position on one day. Reading either as the other is how a return ends
 * up reporting a year of sales as a debtor balance.
 *
 * Whole dollars, the way a signed return rounds them. Each box is its accounts
 * summed exactly and then rounded. Total income and total expenses are rounded
 * from their exact totals, and the other-income and other-expenses boxes take
 * whatever rounding is left, so the form adds up: on real books that is why a
 * depreciation recovery of 339.86 was filed as 339, and other expenses as a
 * dollar more than their own sum. Everything else the form works out -- gross
 * profit, net profit, the asset and liability totals, owners equity -- is
 * arithmetic on the rounded boxes.
 */
export function ir10Summary(options: Ir10Options): Ir10Summary {
  const { yearEnding, yearStarting, journals, openingBalances, chart } = options;
  const asLiabilities = options.currentAccountsAsLiabilities ?? true;
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

  const exact = new Map<number, Cents>();
  const put = (box: number, amount: Cents): void => {
    exact.set(box, (exact.get(box) ?? 0) + amount);
  };
  let nonDeductible = 0;
  let capitalGain = 0;
  let lossOnDisposal = 0;
  let drawings = 0;
  let dividendsPaid = 0;
  let currentAccounts = 0;

  const codes = new Set<string>([...closing.keys(), ...movement.keys()]);
  for (const code of codes) {
    const account = byCode.get(code);
    // A posting with no chart code is a bank line: this app posts the bank side
    // against the account itself, which carries no code.
    const type = account?.type ?? "Bank";
    const name = account?.name ?? code;
    const klass = type.trim().toLowerCase();
    const digits = /(\d{3,4})/.exec(code)?.[1] ?? code;
    const isProfitAndLoss = [
      "revenue", "sales", "other income", "direct costs", "expense", "overhead", "depreciation",
    ].includes(klass);
    const balance = closing.get(code) ?? 0;
    const moved = movement.get(code) ?? 0;
    const box = ir10BoxForAccount(code, type, balance, name);
    if (box === null) continue;

    if (isProfitAndLoss) {
      if (box === 53) {
        capitalGain -= moved;
        continue;
      }
      if (/non[- ]?deductible/i.test(name)) nonDeductible += moved;
      if (digits === "470" || /loss on (the )?(sale|disposal)/i.test(name)) lossOnDisposal += moved;
      // Income is a credit and the form wants it positive; a cost is a debit and
      // already is.
      put(box, INCOME.has(box) ? -moved : moved);
      continue;
    }

    if (box === 47 && shareholderAccount(digits, name.toLowerCase(), klass)) {
      currentAccounts -= balance;
      if (/drawing/i.test(name)) drawings += moved;
      // Equity rather than a liability: left to owners equity, which is worked
      // out as the difference.
      if (!asLiabilities) continue;
    }
    if (/dividends? paid/i.test(name) || (klass === "equity" && /dividend/i.test(name))) {
      dividendsPaid += moved;
    }
    if (box === 51) continue;
    put(box, LIABILITIES.has(box) ? -balance : balance);
  }

  // Stock is one account read at two dates.
  for (const account of chart) {
    const isStock =
      account.type.trim().toLowerCase() === "inventory" ||
      /(\d{3,4})/.exec(account.code)?.[1] === "630";
    if (!isStock) continue;
    put(3, priorClosing.get(account.code) ?? 0);
    put(5, closing.get(account.code) ?? 0);
  }

  // Additions and disposals are the register's: an asset bought in the year at
  // what it cost, and one sold at what it fetched.
  const inYear = (date: IsoDate | null): boolean =>
    date !== null && date >= yearStarting && date <= yearEnding;
  let additions = 0;
  let disposals = 0;
  for (const asset of options.assets ?? []) {
    if (inYear(asset.purchased)) additions += asset.cost;
    if (inYear(asset.disposed)) disposals += options.proceeds?.[asset.number] ?? 0;
  }

  const dollars = (cents: Cents): Cents => Math.round(cents / 100) * 100 + 0;
  const amounts = new Map<number, Cents>();
  const set = (box: number, amount: Cents): void => {
    amounts.set(box, amount + 0);
  };
  for (const line of IR10_LAYOUT) set(line.box, dollars(exact.get(line.box) ?? 0));
  const sum = (boxes: readonly number[]): Cents =>
    boxes.reduce((total, box) => total + (amounts.get(box) ?? 0), 0);
  const exactly = (boxes: readonly number[]): Cents =>
    boxes.reduce((total, box) => total + (exact.get(box) ?? 0), 0);

  set(6, sum([2]) - sum([3]) - sum([4]) + sum([5]));
  set(11, dollars(exactly([2]) - exactly([3]) - exactly([4]) + exactly([5]) + exactly([7, 8, 9, 10])));
  set(10, sum([11]) - sum([6, 7, 8, 9]));
  set(25, dollars(exactly(EXPENSES)));
  set(24, sum([25]) - sum(EXPENSES.filter((box) => box !== 24)));
  set(26, 0);
  set(27, sum([11]) - sum([25]) - sum([26]));
  // No separate tax depreciation is held, so it is taken to equal the
  // accounting figure and adjusts nothing.
  set(52, sum([13]));
  set(28, dollars(nonDeductible) + sum([13]) - sum([52]));
  set(29, sum([27]) + sum([28]));
  set(43, sum(ASSETS));
  set(48, sum([44, 45, 46, 47]));
  set(50, sum([48, 49]));
  set(51, sum([43]) - sum([50]));
  set(53, dollars(capitalGain));
  set(54, dollars(additions));
  set(55, dollars(disposals));
  set(56, dollars(dividendsPaid));
  set(57, dollars(drawings));
  set(58, dollars(currentAccounts));
  set(59, dollars(lossOnDisposal));
  set(60, 0);

  const boxes: Record<number, Ir10Box> = {};
  for (const line of IR10_LAYOUT) {
    boxes[line.box] = {
      box: line.box,
      title: line.title,
      amount: line.box === 1 ? 0 : (amounts.get(line.box) ?? 0),
      ...(line.box === 1 ? { text: options.multipleActivities === true ? "Yes" : "No" } : {}),
      total: line.total === true,
      calculated: CALCULATED.has(line.box),
    };
  }

  const imbalance = [...closing.values()].reduce((total, value) => total + value, 0);
  return { yearEnding, yearStarting, boxes, imbalance, currentAccountsAsLiabilities: asLiabilities };
}

/** Which boxes the form works out rather than takes from an account. */
export function ir10IsCalculated(box: number): boolean {
  return CALCULATED.has(box);
}
