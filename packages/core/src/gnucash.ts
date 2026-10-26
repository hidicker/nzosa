import { parseCsvRecords } from "./csv.js";
import { parseDate } from "./dates.js";
import { parseAmount } from "./money.js";
import type { Account } from "./chart.js";
import type { ImportProblem } from "./types.js";
import { quickBooksPlacement } from "./quickbooks.js";
import type { QuickBooksChart, QuickBooksEntry, QuickBooksLedgerOptions } from "./quickbooks.js";
import { booksWithChart } from "./slowbooks.js";
import type { IifFile, ReadBooks } from "./iif.js";
import { foldGst, isGstAccount } from "./myob.js";

/**
 * GnuCash's CSV exports: the account tree (File, Export, Export Account Tree
 * to CSV) and the transactions (File, Export, Export Transactions to CSV).
 *
 * The transactions file has a row for each split. In its usual layout the
 * first row of a transaction carries the date, number and description and
 * the rest carry only the split; in the simple layout every row carries
 * both. Either way a split's value is signed as GnuCash keeps it: a debit is
 * positive. Accounts are named in full, "Expenses:Auto:Fuel", the first part
 * saying what kind they are where the account tree is not given.
 */

const key = (name: string): string => name.replace(/\s+/g, " ").trim().toLowerCase();

function header(text: string): { names: Map<string, number>; rows: { fields: string[]; line: number }[] } | null {
  const records = parseCsvRecords(text);
  const head = records[0];
  if (head === undefined) return null;
  const names = new Map(head.fields.map((f, i) => [key(f), i]));
  return { names, rows: records.slice(1).map((r) => ({ fields: [...r.fields], line: r.line })) };
}

const cell = (names: Map<string, number>, fields: readonly string[], name: string): string => {
  const i = names.get(key(name));
  return i === undefined ? "" : (fields[i] ?? "").trim();
};

export function isGnuCashTransactions(text: string): boolean {
  const read = header(text.slice(0, 20000));
  return read !== null && read.names.has("full account name") && read.names.has("transaction id") && (read.names.has("value num.") || read.names.has("amount num."));
}

export function isGnuCashAccounts(text: string): boolean {
  const read = header(text.slice(0, 20000));
  return read !== null && read.names.has("full_name") && read.names.has("type") && read.names.has("place_holder");
}

/** GnuCash's account types, in the words the reading after this goes by. */
const TYPES: Record<string, string> = {
  BANK: "Bank",
  CASH: "Bank",
  CREDIT: "Credit Card",
  ASSET: "Other Current Assets",
  STOCK: "Other Assets",
  MUTUAL: "Other Assets",
  RECEIVABLE: "Accounts Receivable (A/R)",
  LIABILITY: "Other Current Liabilities",
  PAYABLE: "Accounts Payable (A/P)",
  INCOME: "Income",
  EXPENSE: "Expenses",
  EQUITY: "Equity",
  TRADING: "Equity",
};

/** A type from the account's place in the tree, where the tree was not given. */
function typeFromName(full: string): string {
  const [top = "", ...rest] = full.split(":");
  const leaf = rest.join(" ");
  switch (top.trim().toLowerCase()) {
    case "assets":
      if (/receivable/i.test(leaf)) return "Accounts Receivable (A/R)";
      return /checking|cheque|savings|\bbank\b|\bcash\b|wallet|petty/i.test(leaf) ? "Bank" : "Other Current Assets";
    case "liabilities":
      if (/payable/i.test(leaf)) return "Accounts Payable (A/P)";
      return /credit card|\bvisa\b|mastercard|\bamex\b/i.test(leaf) ? "Credit Card" : "Other Current Liabilities";
    case "income":
      return "Income";
    case "expenses":
      return "Expenses";
    case "equity":
      return "Equity";
    default:
      return "Other Current Assets";
  }
}

/**
 * The name an account is kept under here: its path without the top level,
 * "Auto: Fuel" for Expenses:Auto:Fuel. Two that would read the same keep
 * their top level to tell them apart.
 */
export function gnuCashNames(fullNames: readonly string[]): Map<string, string> {
  const short = (full: string): string => {
    const parts = full.split(":").map((p) => p.trim()).filter((p) => p !== "");
    return (parts.length > 1 ? parts.slice(1) : parts).join(": ");
  };
  const counts = new Map<string, number>();
  for (const full of new Set(fullNames)) counts.set(key(short(full)), (counts.get(key(short(full))) ?? 0) + 1);
  return new Map(
    [...new Set(fullNames)].map((full) => {
      const name = short(full);
      return [full, (counts.get(key(name)) ?? 0) > 1 ? full.split(":").map((p) => p.trim()).join(": ") : name];
    }),
  );
}

export interface GnuCashAccounts {
  chart: QuickBooksChart;
  problems: ImportProblem[];
}

/** The account tree: each account with its type and code, placeholders left out. */
export function parseGnuCashAccounts(text: string): GnuCashAccounts {
  const accounts: Account[] = [];
  const debitNormal: string[] = [];
  const bankNames: string[] = [];
  const cardNames: string[] = [];
  const problems: ImportProblem[] = [];
  const chart = { accounts, debitNormal, bankNames, cardNames };
  const read = header(text);
  if (read === null) return { chart, problems: [{ line: 1, row: [], message: "Not a GnuCash account tree." }] };
  const rows = read.rows.filter((r) => cell(read.names, r.fields, "full_name") !== "");
  const names = gnuCashNames(rows.map((r) => cell(read.names, r.fields, "full_name")));
  for (const { fields } of rows) {
    if (/^t/i.test(cell(read.names, fields, "place_holder"))) continue;
    const full = cell(read.names, fields, "full_name");
    const name = names.get(full) ?? full;
    const type = TYPES[cell(read.names, fields, "type").toUpperCase()] ?? typeFromName(full);
    const place = quickBooksPlacement(type, /retained (earnings|profits)/i.test(name) ? "Retained Earnings" : "");
    const code = cell(read.names, fields, "code");
    accounts.push({
      code: place.bank ? "" : code,
      name,
      type: place.type,
      taxCode: "",
      description: [type === "Credit Card" ? "Credit Card" : "", `GnuCash ${full}`].filter(Boolean).join(" "),
    });
    if (place.debit) debitNormal.push(name);
    if (place.bank) bankNames.push(name);
    if (place.card) cardNames.push(name);
  }
  return { chart, problems };
}

/** The transactions, each from its splits; voided ones left out. */
export function parseGnuCashJournal(text: string, chart: QuickBooksChart | null, options: QuickBooksLedgerOptions = {}): IifFile {
  const problems: ImportProblem[] = [];
  const accounts: Account[] = [...(chart?.accounts ?? [])];
  const debitNormal = [...(chart?.debitNormal ?? [])];
  const bankNames = [...(chart?.bankNames ?? [])];
  const cardNames = [...(chart?.cardNames ?? [])];
  const entries: QuickBooksEntry[] = [];
  const empty: IifFile = { chart: { accounts, debitNormal, bankNames, cardNames }, entries, contacts: [], classes: new Map(), items: [], problems };
  const read = header(text);
  if (read === null) return { ...empty, problems: [{ line: 1, row: [], message: "Not a GnuCash transactions file." }] };
  const get = (fields: readonly string[], name: string): string => cell(read.names, fields, name);
  const currency = options.currency ?? "NZD";

  // Accounts by their full name: the tree's, where it was given, else made here.
  const byFull = new Map<string, string>();
  for (const a of accounts) {
    const full = /\bGnuCash (.+)$/.exec(a.description)?.[1];
    if (full !== undefined) byFull.set(full, a.name);
  }
  const fulls = read.rows.map((r) => get(r.fields, "Full Account Name")).filter((f) => f !== "");
  const madeNames = gnuCashNames(fulls);
  const nameFor = (full: string): string => {
    const known = byFull.get(full);
    if (known !== undefined) return known;
    const name = madeNames.get(full) ?? full;
    const type = typeFromName(full);
    const place = quickBooksPlacement(type, "");
    accounts.push({ code: "", name, type: place.type, taxCode: "", description: `GnuCash ${full}` });
    if (place.debit) debitNormal.push(name);
    if (place.bank) bankNames.push(name);
    if (place.card) cardNames.push(name);
    byFull.set(full, name);
    return name;
  };

  let current: QuickBooksEntry | null = null;
  let currentId = "";
  let voided = false;
  for (const { fields, line } of read.rows) {
    const id = get(fields, "Transaction ID");
    const dated = get(fields, "Date");
    // A new transaction where its id changes, or a dated row starts one.
    if ((id !== "" && id !== currentId) || (id === "" && dated !== "" && current !== null && get(fields, "Full Account Name") === "")) {
      current = null;
    }
    if (current === null) {
      if (dated === "") continue;
      const date = parseDate(dated, { dayFirst: options.dayFirst ?? true });
      if (date === null) {
        problems.push({ line, row: [...fields], message: `Unreadable date ${JSON.stringify(dated)}` });
        currentId = id;
        voided = true;
        continue;
      }
      voided = get(fields, "Void Reason") !== "";
      currentId = id;
      const description = get(fields, "Description");
      const notes = get(fields, "Notes");
      current = { date, type: "Journal Entry", num: get(fields, "Number"), name: description, memo: [description, notes].filter((x) => x !== "").join(" — "), legs: [] };
      if (!voided) entries.push(current);
    }
    if (voided) continue;
    const full = get(fields, "Full Account Name");
    if (full === "") continue;
    const said = get(fields, "Value Num.") || get(fields, "Amount Num.");
    const value = parseAmount(said || "0", currency);
    if (value === null) {
      problems.push({ line, row: [...fields], message: `Unreadable amount ${JSON.stringify(said)}` });
      continue;
    }
    if (value === 0) continue;
    current.legs.push({ account: nameFor(full), debit: value, ...(get(fields, "Memo") !== "" ? { memo: get(fields, "Memo") } : {}) });
  }

  // GST kept as splits of its own goes back into the costs and sales it was
  // on, where money moved through the bank: worked out once, from the coding.
  const bank = new Set(bankNames);
  const gst = new Set(accounts.filter((a) => isGstAccount(a)).map((a) => a.name));
  for (const entry of entries) {
    if (entry.legs.some((leg) => bank.has(leg.account))) foldGst(entry, (name) => gst.has(name), (name) => bank.has(name));
  }
  const balanced = entries.filter((entry) => {
    if (entry.legs.length > 0 && entry.legs.reduce((sum, leg) => sum + leg.debit, 0) === 0) return true;
    if (entry.legs.length === 0) return false;
    problems.push({ line: 0, row: [], message: `${entry.date} ${entry.num} ${entry.memo} does not balance and was left out`.replace(/\s+/g, " ") });
    return false;
  });
  return { ...empty, entries: balanced };
}

/** Everything a GnuCash transactions file holds, as this app keeps it. */
export function parseGnuCashBooks(text: string, chart: QuickBooksChart | null, options: QuickBooksLedgerOptions = {}): ReadBooks {
  return booksWithChart(parseGnuCashJournal(text, chart, options), chart, options, "transactions.csv", "gnucash-transactions");
}
