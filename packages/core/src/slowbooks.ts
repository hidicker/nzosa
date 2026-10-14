import { findHeaderRow, parseCsvRecords } from "./csv.js";
import { parseDate } from "./dates.js";
import { parseAmount } from "./money.js";
import { ColumnReader } from "./importers/shared.js";
import type { Account } from "./chart.js";
import type { ImportProblem } from "./types.js";
import { quickBooksPlacement } from "./quickbooks.js";
import type { QuickBooksChart, QuickBooksEntry, QuickBooksLedgerOptions } from "./quickbooks.js";
import { booksFromEntries } from "./iif.js";
import type { IifFile, ReadBooks } from "./iif.js";

/**
 * SlowBooks Pro's General Ledger report, saved as CSV.
 *
 * One row a posting, under its account, with the account's number and name,
 * debit and credit, and what made it (`Source type`: invoice, bill, payment,
 * bill_payment, manual...). Unlike SlowBooks' IIF export, which leaves out
 * journal entries and bill payments, it holds every posting, so it is the file
 * to move the books with. Rows that share a date, source, reference and
 * description are one entry.
 *
 * The report gives no account types. They are read from the numbers, which
 * SlowBooks, like QuickBooks, gives in ranges -- 1000s assets, 2000s
 * liabilities, 3000s equity, 4000s income, 5000s cost of sales, 6000s and on
 * expenses -- and from the names: checking and savings accounts, receivables,
 * payables and credit cards say what they are.
 */

const COLUMNS = ["Date", "Account name", "Debit", "Credit", "Source type"] as const;

export function isSlowBooksLedger(text: string): boolean {
  return findHeaderRow(parseCsvRecords(text.slice(0, 20000)), COLUMNS, 12) !== null;
}

/** What each source type is, as QuickBooks names it: the reading after this goes by those names. */
const SOURCE_TYPES: Record<string, string> = {
  invoice: "Invoice",
  bill: "Bill",
  payment: "Payment",
  bill_payment: "Bill Payment (Check)",
  manual: "Journal Entry",
  journal: "Journal Entry",
  deposit: "Deposit",
  sales_receipt: "Sales Receipt",
  check: "Check",
  expense: "Expense",
  credit_memo: "Credit Memo",
  vendor_credit: "Vendor Credit",
  cc_charge: "Credit Card Expense",
  transfer: "Transfer",
  payroll: "Payroll Check",
  depreciation: "Journal Entry",
};

/** The QuickBooks type an account's number and name make it. */
function typeOf(number: string, name: string): string {
  const n = Number(number);
  if (/accounts receivable|\breceivable\b/i.test(name)) return "Accounts Receivable (A/R)";
  if (/accounts payable/i.test(name)) return "Accounts Payable (A/P)";
  if (/credit card|\bvisa\b|mastercard|\bamex\b|american express/i.test(name)) return "Credit Card";
  if (/checking|savings|\bbank\b|money market|petty cash|^cash\b/i.test(name) && !/charge|fee|interest/i.test(name)) return "Bank";
  if (!Number.isFinite(n) || number.trim() === "") return "Expenses";
  if (n < 1500) return "Other Current Assets";
  if (n < 2000) return "Fixed Assets";
  if (n < 2500) return "Other Current Liabilities";
  if (n < 3000) return "Long Term Liabilities";
  if (n < 4000) return "Equity";
  if (n < 4900) return "Income";
  if (n < 5000) return "Other Income";
  if (n < 6000) return "Cost of Goods Sold";
  if (n < 8000) return "Expenses";
  return /income|gain|interest earned/i.test(name) ? "Other Income" : "Other Expense";
}

/** Who an entry was with, from SlowBooks' description of it. */
function nameFrom(description: string): string {
  const dash = / - (.+)$/.exec(description);
  if (dash?.[1] !== undefined) return dash[1].trim();
  const from = /^(?:Payment|Deposit|Refund) from (.+)$/i.exec(description);
  if (from?.[1] !== undefined) return from[1].trim();
  const to = /^(?:Bill payment|Payment|Check|Refund) to (.+)$/i.exec(description);
  if (to?.[1] !== undefined) return to[1].trim();
  return "";
}

/** The document's number, from the reference or the description ("Bill OD-1 - Office Depot"). */
function numberFrom(reference: string, description: string): string {
  if (reference.trim() !== "") return reference.trim();
  const said = /^(?:Invoice|Bill|Credit memo|Estimate|Sales receipt)\s+#?(\S+)\s+-/i.exec(description);
  return said?.[1] ?? "";
}

export function parseSlowBooksLedger(text: string, options: QuickBooksLedgerOptions = {}): IifFile {
  const records = parseCsvRecords(text);
  const header = findHeaderRow(records, COLUMNS, 12);
  const problems: ImportProblem[] = [];
  const accounts: Account[] = [];
  const debitNormal: string[] = [];
  const bankNames: string[] = [];
  const cardNames: string[] = [];
  const entries: QuickBooksEntry[] = [];
  const classes = new Map<QuickBooksEntry, string>();
  const empty: IifFile = {
    chart: { accounts, debitNormal, bankNames, cardNames },
    entries,
    contacts: [],
    classes,
    items: [],
    problems,
  };
  if (header === null) return { ...empty, problems: [{ line: 1, row: [], message: "Not a SlowBooks general ledger." }] };
  const currency = options.currency ?? "USD";
  const reader = new ColumnReader(header.columns);
  const groups = new Map<string, QuickBooksEntry>();
  const named = new Set<string>();

  for (const { fields, line } of records.slice(header.index + 1)) {
    const cells = reader.at(fields);
    const source = cells.get("Source type").trim().toLowerCase();
    // The balance brought forward and the period totals are not postings.
    if (source === "" || source === "opening" || source === "total") continue;
    const date = parseDate(cells.get("Date"), { dayFirst: options.dayFirst ?? false });
    if (date === null) {
      problems.push({ line, row: [...fields], message: `Unreadable date ${JSON.stringify(cells.get("Date"))}` });
      continue;
    }
    const name = cells.get("Account name").trim();
    const number = cells.get("Account number").trim();
    if (name === "") continue;
    if (!named.has(name)) {
      named.add(name);
      const type = typeOf(number, name);
      const place = quickBooksPlacement(type, /retained earnings/i.test(name) ? "Retained Earnings" : "");
      accounts.push({
        code: place.bank ? "" : number,
        name,
        type: place.type,
        taxCode: "",
        description: type === "Credit Card" ? "Credit Card" : "",
      } as Account);
      if (place.debit) debitNormal.push(name);
      if (place.bank) bankNames.push(name);
      if (place.card) cardNames.push(name);
    }
    const debit = parseAmount(cells.get("Debit") || "0", currency);
    const credit = parseAmount(cells.get("Credit") || "0", currency);
    if (debit === null || credit === null) {
      problems.push({ line, row: [...fields], message: "Unreadable debit or credit" });
      continue;
    }
    const reference = cells.get("Reference").trim();
    const description = cells.get("Description").trim();
    const key = `${date}\u0000${source}\u0000${reference}\u0000${description}`;
    let entry = groups.get(key);
    if (entry === undefined) {
      entry = {
        date,
        type: SOURCE_TYPES[source] ?? "Journal Entry",
        num: numberFrom(reference, description),
        name: nameFrom(description),
        memo: description,
        legs: [],
      };
      groups.set(key, entry);
      entries.push(entry);
      const klass = cells.get("Class").trim();
      if (klass !== "" && !/^uncategori[sz]ed$/i.test(klass)) classes.set(entry, klass);
    }
    entry.legs.push({ account: name, debit: debit - credit });
  }

  // An entry whose postings do not add to nothing has lost a row; it is left
  // out and said, rather than put in out of balance.
  const balanced = entries.filter((entry) => {
    if (entry.legs.reduce((sum, leg) => sum + leg.debit, 0) === 0) return true;
    problems.push({ line: 0, row: [], message: `${entry.date} ${entry.memo} does not balance and was left out` });
    return false;
  });
  // Bank accounts last among their kind keep the order the report gave.
  const chart: QuickBooksChart = { accounts, debitNormal, bankNames, cardNames };
  return { ...empty, chart, entries: balanced };
}

/** Everything SlowBooks' general ledger holds, as this app keeps it. */
export function parseSlowBooksBooks(
  text: string,
  chart: QuickBooksChart | null,
  options: QuickBooksLedgerOptions = {},
): ReadBooks {
  const read = parseSlowBooksLedger(text, options);
  // The books' own chart, where there is one, for the accounts it has; the
  // report's for the rest.
  let used = read.chart;
  if (chart !== null && chart.accounts.length > 0) {
    const have = new Set(chart.accounts.map((a) => a.name));
    const extra = read.chart.accounts.filter((a) => !have.has(a.name));
    used = {
      accounts: [...chart.accounts, ...extra],
      debitNormal: [...chart.debitNormal, ...read.chart.debitNormal.filter((n) => !have.has(n))],
      bankNames: [...chart.bankNames, ...read.chart.bankNames.filter((n) => !have.has(n))],
      cardNames: [...chart.cardNames, ...read.chart.cardNames.filter((n) => !have.has(n))],
    };
  }
  return booksFromEntries(
    { ...read, chart: used },
    used,
    { ...options, file: options.file ?? "general-ledger.csv" },
    "slowbooks-ledger",
  );
}
