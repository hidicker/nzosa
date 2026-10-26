import { parseCsvRecords } from "./csv.js";
import type { CsvRecord } from "./csv.js";
import { parseDate } from "./dates.js";
import { parseAmount } from "./money.js";
import type { Account } from "./chart.js";
import type { ImportProblem } from "./types.js";
import { quickBooksPlacement } from "./quickbooks.js";
import type { QuickBooksChart, QuickBooksEntry, QuickBooksLedgerOptions } from "./quickbooks.js";
import { booksWithChart } from "./slowbooks.js";
import type { IifFile, ReadBooks } from "./iif.js";

/**
 * MYOB's export files: the accounts list, and journal entries.
 *
 * Both MYOB Business and AccountRight export to tab-separated text (or comma
 * separated, chosen when exporting). A file meant for MYOB may start with a
 * row of brackets, which says it is MYOB's; then a row of field names; then
 * the records. In a journal file each entry is its lines, one after another,
 * and a blank line ends it.
 *
 * Accounts are numbered by MYOB's scheme -- 1-1110 -- whose first digit is
 * the kind: 1 assets, 2 liabilities, 3 equity, 4 income, 5 cost of sales,
 * 6 expenses, 8 other income, 9 other expenses. The accounts list says each
 * account's type outright, and that is used where it is given.
 */

/** A record's cells by field name, ignoring case and spacing. */
class Fields {
  private readonly index = new Map<string, number>();
  constructor(names: readonly string[]) {
    names.forEach((name, i) => this.index.set(key(name), i));
  }
  has(name: string): boolean {
    return this.index.has(key(name));
  }
  get(fields: readonly string[], name: string): string {
    const i = this.index.get(key(name));
    return i === undefined ? "" : (fields[i] ?? "").trim();
  }
}

const key = (name: string): string => name.replace(/^[*^]/, "").replace(/\s+/g, " ").trim().toLowerCase();

/** The records after any bracket row, the first being the field names. */
function withHeader(text: string): { header: string[]; rows: CsvRecord[] } | null {
  const records = parseCsvRecords(text);
  let start = 0;
  // MYOB's own marker: "{}" or "()" alone in the first cell.
  if (/^[{(\[]\s*[})\]]$/.test((records[0]?.fields[0] ?? "").trim())) start = 1;
  const head = records[start];
  if (head === undefined) return null;
  return { header: head.fields.map((f) => f.trim()), rows: records.slice(start + 1) };
}

export function isMyobAccounts(text: string): boolean {
  const read = withHeader(text.slice(0, 20000));
  if (read === null) return false;
  const f = new Fields(read.header);
  return f.has("Account Number") && f.has("Account Name") && (f.has("Account Type") || f.has("Header")) && !f.has("Debit Amount");
}

export function isMyobJournal(text: string): boolean {
  const read = withHeader(text.slice(0, 20000));
  if (read === null) return false;
  const f = new Fields(read.header);
  return f.has("Account Number") && f.has("Debit Amount") && f.has("Credit Amount") && f.has("Date");
}

/** The QuickBooks type a MYOB account type is, the names the reading after this goes by. */
const TYPES: Record<string, string> = {
  bank: "Bank",
  "accounts receivable": "Accounts Receivable (A/R)",
  "other current asset": "Other Current Assets",
  "fixed asset": "Fixed Assets",
  "other asset": "Other Assets",
  "credit card": "Credit Card",
  "accounts payable": "Accounts Payable (A/P)",
  "other current liability": "Other Current Liabilities",
  "long term liability": "Long Term Liabilities",
  "other liability": "Other Current Liabilities",
  equity: "Equity",
  income: "Income",
  "cost of sales": "Cost of Goods Sold",
  expense: "Expenses",
  "other income": "Other Income",
  "other expense": "Other Expense",
};

/** An account's type from its number, where MYOB did not say. */
function typeFromNumber(number: string, name: string): string {
  if (/accounts receivable|trade debtors/i.test(name)) return "Accounts Receivable (A/R)";
  if (/accounts payable|trade creditors/i.test(name)) return "Accounts Payable (A/P)";
  switch (number.trim().charAt(0)) {
    case "1":
      return /cheque|savings|\bbank\b|petty cash|^cash\b/i.test(name) ? "Bank" : "Other Current Assets";
    case "2":
      return /credit card|\bvisa\b|mastercard|\bamex\b/i.test(name) ? "Credit Card" : "Other Current Liabilities";
    case "3":
      return "Equity";
    case "4":
      return "Income";
    case "5":
      return "Cost of Goods Sold";
    case "8":
      return "Other Income";
    case "9":
      return "Other Expense";
    default:
      return "Expenses";
  }
}

/**
 * A MYOB tax code in the words this app's GST reads: New Zealand's S15, S,
 * E, Z, IMP and N-T, and Australia's GST, FRE, INP, ITS, EXP, CAP and N-T.
 * Codes with no plain equivalent (ABN withholding, WET, LCT) are left blank.
 */
function taxWords(code: string, income: boolean, country: string): string {
  const c = code.trim().toUpperCase();
  const side = income ? "Income" : "Expenses";
  if (country === "au") {
    if (c === "GST") return `GST on ${side}`;
    if (c === "FRE") return `GST Free ${side}`;
    if (c === "EXP") return "GST Free Exports";
    if (c === "INP" || c === "ITS") return `Input Taxed ${side}`;
    if (c === "CAP") return "GST on Capital";
    if (c === "N-T") return "BAS Excluded";
    return "";
  }
  if (c === "S15" || c === "S" || c === "GST") return `15% GST on ${side}`;
  if (c === "E") return `Exempt ${side}`;
  if (c === "Z") return `Zero Rated ${side}`;
  if (c === "IMP") return "GST on Imports";
  if (c === "N-T") return "No GST";
  return "";
}

const isIncome = (qbType: string): boolean => qbType === "Income" || qbType === "Other Income";

export interface MyobAccounts {
  chart: QuickBooksChart;
  problems: ImportProblem[];
}

/** MYOB's accounts list as a chart. Header accounts, which hold nothing, are left out. */
export function parseMyobAccounts(text: string, options: { country?: string } = {}): MyobAccounts {
  const accounts: Account[] = [];
  const debitNormal: string[] = [];
  const bankNames: string[] = [];
  const cardNames: string[] = [];
  const problems: ImportProblem[] = [];
  const read = withHeader(text);
  const chart = { accounts, debitNormal, bankNames, cardNames };
  if (read === null) return { chart, problems: [{ line: 1, row: [], message: "Not a MYOB accounts list." }] };
  const f = new Fields(read.header);
  const seen = new Set<string>();
  for (const { fields, line } of read.rows) {
    const number = f.get(fields, "Account Number");
    const name = f.get(fields, "Account Name");
    if (number === "" && name === "") continue;
    if (/^h/i.test(f.get(fields, "Header"))) continue;
    if (name === "") {
      problems.push({ line, row: [...fields], message: `Account ${number} has no name` });
      continue;
    }
    if (seen.has(number || name)) continue;
    seen.add(number || name);
    const said = TYPES[f.get(fields, "Account Type").toLowerCase()];
    const type = said ?? typeFromNumber(number, name);
    const place = quickBooksPlacement(type, /retained (earnings|profits)|current year earnings/i.test(name) ? "Retained Earnings" : "");
    accounts.push({
      code: place.bank ? "" : number,
      name,
      type: place.type,
      taxCode: taxWords(f.get(fields, "Tax Code"), isIncome(type), options.country ?? "nz"),
      description: [type === "Credit Card" ? "Credit Card" : "", place.bank && number !== "" ? `MYOB ${number}` : ""].filter(Boolean).join(" "),
    });
    if (place.debit) debitNormal.push(name);
    if (place.bank) bankNames.push(name);
    if (place.card) cardNames.push(name);
  }
  return { chart, problems };
}

/** A chart account's MYOB number: its code, or the number a bank account's description keeps. */
function numberOf(account: Account): string {
  if (account.code.trim() !== "") return account.code.trim();
  return /\bMYOB (\S+)/.exec(account.description)?.[1] ?? "";
}

/**
 * MYOB's journal entries, each from its lines to the blank line after them.
 * Each line names its account by number, read through the chart given; a
 * number the chart does not have becomes an account of its own, typed by its
 * first digit.
 */
export function parseMyobJournal(text: string, chart: QuickBooksChart | null, options: QuickBooksLedgerOptions = {}): IifFile {
  const problems: ImportProblem[] = [];
  const accounts: Account[] = [...(chart?.accounts ?? [])];
  const debitNormal = [...(chart?.debitNormal ?? [])];
  const bankNames = [...(chart?.bankNames ?? [])];
  const cardNames = [...(chart?.cardNames ?? [])];
  const entries: QuickBooksEntry[] = [];
  const empty: IifFile = {
    chart: { accounts, debitNormal, bankNames, cardNames },
    entries,
    contacts: [],
    classes: new Map(),
    items: [],
    problems,
  };
  const read = withHeader(text);
  if (read === null) return { ...empty, problems: [{ line: 1, row: [], message: "Not a MYOB journal file." }] };
  const f = new Fields(read.header);
  const currency = options.currency ?? "NZD";
  const byNumber = new Map<string, string>();
  for (const a of accounts) {
    const n = numberOf(a);
    if (n !== "") byNumber.set(n.replace(/\D/g, ""), a.name);
  }
  const nameFor = (number: string): string => {
    const known = byNumber.get(number.replace(/\D/g, ""));
    if (known !== undefined) return known;
    // Not in the chart: an account of its own, typed by its number.
    const type = typeFromNumber(number, "");
    const place = quickBooksPlacement(type, "");
    const name = `MYOB account ${number}`;
    accounts.push({ code: place.bank ? "" : number, name, type: place.type, taxCode: "", description: place.bank ? `MYOB ${number}` : "" });
    if (place.debit) debitNormal.push(name);
    if (place.bank) bankNames.push(name);
    byNumber.set(number.replace(/\D/g, ""), name);
    return name;
  };

  let current: QuickBooksEntry | null = null;
  let lastLine = -1;
  let date: string | null = null;
  for (const { fields, line } of read.rows) {
    // A blank line between two records ends the entry before it.
    if (current !== null && line > lastLine + 1) current = null;
    lastLine = line;
    const number = f.get(fields, "Account Number");
    if (number === "") continue;
    if (current === null) {
      date = parseDate(f.get(fields, "Date"), { dayFirst: options.dayFirst ?? true });
      if (date === null) {
        problems.push({ line, row: [...fields], message: `Unreadable date ${JSON.stringify(f.get(fields, "Date"))}` });
        continue;
      }
      const memo = f.get(fields, "Memo");
      current = { date, type: "Journal Entry", num: f.get(fields, "Journal Number") || f.get(fields, "ID No."), name: "", memo, legs: [] };
      entries.push(current);
    }
    const debit = parseAmount(f.get(fields, "Debit Amount") || "0", currency);
    const credit = parseAmount(f.get(fields, "Credit Amount") || "0", currency);
    if (debit === null || credit === null) {
      problems.push({ line, row: [...fields], message: "Unreadable debit or credit" });
      continue;
    }
    if (debit === 0 && credit === 0) continue;
    current.legs.push({ account: nameFor(number), debit: debit - credit });
  }

  // MYOB keeps the GST on a purchase or a sale as a line of its own, to its
  // GST account. Paid from the bank, the GST goes back into the lines it was
  // on, so the bank line is coded at its full amount and its GST is worked
  // out once, from the account's tax code -- as a bank line coded here is.
  const bank = new Set(bankNames);
  const gst = new Set(accounts.filter((a) => isGstAccount(a)).map((a) => a.name));
  for (const entry of entries) {
    if (entry.legs.some((leg) => bank.has(leg.account))) foldGst(entry, (name) => gst.has(name), (name) => bank.has(name));
  }

  // An entry whose lines do not add to nothing has lost one; it is left out
  // and said, rather than put in out of balance.
  const balanced = entries.filter((entry) => {
    if (entry.legs.length > 0 && entry.legs.reduce((sum, leg) => sum + leg.debit, 0) === 0) return true;
    problems.push({ line: 0, row: [], message: `${entry.date} ${entry.num} ${entry.memo} does not balance and was left out`.replace(/\s+/g, " ") });
    return false;
  });
  return { ...empty, entries: balanced };
}

/** A GST control account: GST Collected, GST Paid, and the like -- not a penalty or interest on it. */
export function isGstAccount(account: Account): boolean {
  return /\bGST\b|goods and services tax/i.test(account.name) && !/penalt|interest|expense/i.test(account.name) && !/revenue|expense|overhead|direct/i.test(account.type);
}

/**
 * Put an entry's GST lines into the lines they were charged on, in proportion
 * -- the GST on a purchase into its costs, on a sale into its income -- to the
 * cent. An entry with nothing for the GST to go into (paying the GST to IRD)
 * is left as it is.
 */
export function foldGst(entry: QuickBooksEntry, isGst: (name: string) => boolean, isBank: (name: string) => boolean): void {
  const tax = entry.legs.filter((leg) => isGst(leg.account));
  const total = tax.reduce((sum, leg) => sum + leg.debit, 0);
  if (tax.length === 0 || total === 0) return;
  const into = entry.legs.filter((leg) => !isGst(leg.account) && !isBank(leg.account) && Math.sign(leg.debit) === Math.sign(total));
  const base = into.reduce((sum, leg) => sum + leg.debit, 0);
  if (into.length === 0 || base === 0) return;
  let given = 0;
  into.forEach((leg, i) => {
    const share = i === into.length - 1 ? total - given : Math.round((total * leg.debit) / base);
    leg.debit += share;
    given += share;
  });
  entry.legs = entry.legs.filter((leg) => !isGst(leg.account));
}

/** Everything a MYOB journal file holds, as this app keeps it. */
export function parseMyobBooks(text: string, chart: QuickBooksChart | null, options: QuickBooksLedgerOptions = {}): ReadBooks {
  return booksWithChart(parseMyobJournal(text, chart, options), chart, options, "journal.txt", "myob-journal");
}
