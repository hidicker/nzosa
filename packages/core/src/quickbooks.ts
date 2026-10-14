import { findHeaderRow, parseCsvRecords } from "./csv.js";
import { parseDate } from "./dates.js";
import { parseAmount } from "./money.js";
import { ColumnReader } from "./importers/shared.js";
import type { Account } from "./chart.js";
import type { ReferenceLine } from "./coding-check.js";
import type { ImportProblem, Transaction } from "./types.js";

/**
 * QuickBooks Online's two exports that move a business across: the chart of
 * accounts, and the general ledger.
 *
 * The chart is a plain list -- account name, type, detail type -- with no
 * codes, because QuickBooks does not use them. The general ledger is a report
 * grouped by account: a heading row for each account, then its postings, each
 * with the account on the other side of the entry in `Split`. Read together
 * they give what Xero's chart and account transactions give: the accounts,
 * the bank lines, and what each bank line was coded to.
 *
 * Nothing here is United States only. The exports have the same shape in
 * every country QuickBooks Online is sold in; what differs is the date order
 * and the tax columns, and the date order is the caller's to say.
 */

const CHART_COLUMNS = ["Account name", "Account type", "Detail type"] as const;
const LEDGER_COLUMNS = ["Distribution account", "Transaction date", "Transaction type", "Amount"] as const;

export function isQuickBooksChart(text: string): boolean {
  return findHeaderRow(parseCsvRecords(text), CHART_COLUMNS, 5) !== null;
}

export function isQuickBooksLedger(text: string): boolean {
  return findHeaderRow(parseCsvRecords(text), LEDGER_COLUMNS, 12) !== null;
}

/** Where each of QuickBooks' account types goes in the chart this app keeps. */
interface Placement {
  type: string;
  /** First code of the range; null for accounts that carry none, as Xero's bank accounts do. */
  base: number | null;
  /** Whether the account is one money is paid into and out of. */
  bank: boolean;
  /** A credit card holds what is owed, so a purchase raises it. */
  card: boolean;
}

function placementOf(type: string, detail: string): Placement {
  const t = type.toLowerCase();
  const d = detail.toLowerCase();
  if (t === "bank") return { type: "Bank", base: null, bank: true, card: false };
  if (t === "credit card") return { type: "Bank", base: null, bank: true, card: true };
  if (t.startsWith("accounts receivable")) return { type: "Accounts Receivable", base: 1100, bank: false, card: false };
  if (t === "other current assets") return { type: "Current Asset", base: 1200, bank: false, card: false };
  if (t === "fixed assets") return { type: "Fixed Asset", base: 1500, bank: false, card: false };
  if (t === "other assets") return { type: "Non-current Asset", base: 1800, bank: false, card: false };
  if (t.startsWith("accounts payable")) return { type: "Accounts Payable", base: 2000, bank: false, card: false };
  if (t === "other current liabilities") return { type: "Current Liability", base: 2100, bank: false, card: false };
  if (t === "long term liabilities") return { type: "Non-current Liability", base: 2500, bank: false, card: false };
  if (t === "equity") {
    return { type: d === "retained earnings" ? "Retained Earnings" : "Equity", base: 3000, bank: false, card: false };
  }
  if (t === "income") return { type: "Revenue", base: 4000, bank: false, card: false };
  if (t === "other income") return { type: "Other Income", base: 4900, bank: false, card: false };
  if (t === "cost of goods sold") return { type: "Direct Costs", base: 5000, bank: false, card: false };
  if (t === "expenses") return { type: "Overhead", base: 6000, bank: false, card: false };
  if (t === "other expense") return { type: "Expense", base: 8000, bank: false, card: false };
  return { type: "Expense", base: 6900, bank: false, card: false };
}

export interface QuickBooksChart {
  accounts: Account[];
  /** Names of the accounts money moves through: bank accounts and credit cards. */
  bankNames: string[];
  /** The ones that are credit cards, whose amounts run the other way. */
  cardNames: string[];
}

/**
 * The chart of accounts export, as accounts.
 *
 * QuickBooks has no account codes, so codes are made: a range for each type,
 * in the order the file lists them, in steps of ten so an account can be
 * inserted by hand. A sub-account keeps its whole name ("Automobile:Fuel"),
 * which is what the general ledger's `Split` column calls it. Bank accounts
 * and cards are given none, as Xero's are.
 */
export function parseQuickBooksChart(text: string): QuickBooksChart {
  const records = parseCsvRecords(text);
  const header = findHeaderRow(records, CHART_COLUMNS, 5);
  const accounts: Account[] = [];
  const bankNames: string[] = [];
  const cardNames: string[] = [];
  if (header === null) return { accounts, bankNames, cardNames };
  const reader = new ColumnReader(header.columns);
  const next = new Map<number, number>();
  const seen = new Set<string>();

  for (const record of records.slice(header.index + 1)) {
    const cells = reader.at(record.fields);
    const name = cells.get("Account name").trim();
    if (name === "" || seen.has(name)) continue;
    seen.add(name);
    const place = placementOf(cells.get("Account type"), cells.get("Detail type"));
    let code = "";
    if (place.base !== null) {
      const n = next.get(place.base) ?? place.base;
      code = String(n);
      next.set(place.base, n + 10);
    }
    accounts.push({
      code,
      name,
      type: place.type,
      taxCode: "",
      description: cells.get("Detail type"),
    } as Account);
    if (place.bank) bankNames.push(name);
    if (place.card) cardNames.push(name);
  }
  return { accounts, bankNames, cardNames };
}

export interface QuickBooksLedgerOptions {
  /** Bank and card accounts by name, from the chart; guessed from the names when not given. */
  bankNames?: readonly string[];
  cardNames?: readonly string[];
  /** Account codes by name, so what a line was coded to is given as the chart gives it. */
  codes?: ReadonlyMap<string, string>;
  /**
   * Whether 03/04/2026 is 3 April, for a file whose dates do not settle it.
   * The United States writes the month first. A file with a day past 12 in
   * either place settles it for itself.
   */
  dayFirst?: boolean;
  currency?: string;
  /** File name, for where each line came from. */
  file?: string;
}

export interface QuickBooksLedger {
  /** The lines of the bank and card accounts, as bank lines. */
  transactions: Transaction[];
  /** What each of those lines was coded to, for the coding check and for rules. */
  reference: ReferenceLine[];
  problems: ImportProblem[];
}

const BANKISH = /\b(checking|savings|bank|cheque|current account|money market|visa|mastercard|amex|american express|credit card|card|paypal|stripe|wise)\b/i;

/** Which way round the file's dates go, from any date with a part past 12; null when none says. */
function dateOrderOf(
  records: readonly { fields: readonly string[] }[],
  headerIndex: number,
  reader: ColumnReader,
): boolean | null {
  let first = false;
  let second = false;
  for (const record of records.slice(headerIndex + 1)) {
    const match = /^(\d{1,2})\/(\d{1,2})\/\d{2,4}$/.exec(reader.at(record.fields).get("Transaction date").trim());
    if (match === null) continue;
    if (Number(match[1]) > 12) first = true;
    if (Number(match[2]) > 12) second = true;
  }
  if (first && !second) return true;
  if (second && !first) return false;
  return null;
}

/** `Business Checking` as `business-checking`, the id an account the file names is given. */
function accountId(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "quickbooks"
  );
}

/**
 * The general ledger export, as bank lines and the coding behind them.
 *
 * Only the postings of bank and card accounts become bank lines: every other
 * account's rows are the other side of one of those, or of an invoice or a
 * bill, which come from their own files. Each bank line carries what it was
 * coded to -- the `Split` column, the account on the other side -- as a
 * reference line, so the books can be checked against what QuickBooks said.
 * An entry split across several accounts says "-Split-" and is left for the
 * person to split here.
 */
export function parseQuickBooksLedger(text: string, options: QuickBooksLedgerOptions = {}): QuickBooksLedger {
  const records = parseCsvRecords(text);
  const header = findHeaderRow(records, LEDGER_COLUMNS, 12);
  const transactions: Transaction[] = [];
  const reference: ReferenceLine[] = [];
  const problems: ImportProblem[] = [];
  if (header === null) {
    return { transactions, reference, problems: [{ line: 1, row: [], message: "Not a QuickBooks general ledger." }] };
  }

  const currency = options.currency ?? "USD";
  const file = options.file ?? "general-ledger.csv";
  const reader = new ColumnReader(header.columns);
  const known = options.bankNames !== undefined ? new Set(options.bankNames) : null;
  const cards = new Set(options.cardNames ?? []);
  const isBank = (name: string): boolean => (known !== null ? known.has(name) : BANKISH.test(name));
  const isCard = (name: string): boolean => (known !== null ? cards.has(name) : /\b(visa|mastercard|amex|american express|credit card)\b/i.test(name));
  const dayFirst = dateOrderOf(records, header.index, reader) ?? options.dayFirst ?? false;
  const unsplit = /^-?\s*split\s*-?$/i;

  for (const record of records.slice(header.index + 1)) {
    const { fields, line } = record;
    const cells = reader.at(fields);
    const name = cells.get("Distribution account").trim();
    if (name === "" || !isBank(name)) continue;
    const dateText = cells.get("Transaction date");
    const date = parseDate(dateText, { dayFirst });
    if (date === null) {
      // "Beginning Balance" and total rows have no date and are not lines.
      if (dateText.trim() !== "") {
        problems.push({ line, row: [...fields], message: `Unreadable date ${JSON.stringify(dateText)}` });
      }
      continue;
    }
    const raw = parseAmount(cells.get("Amount") || "0", currency);
    if (raw === null) {
      problems.push({ line, row: [...fields], message: `Unreadable amount ${JSON.stringify(cells.get("Amount"))}` });
      continue;
    }
    // A card holds what is owed: QuickBooks shows a purchase as a positive
    // figure there, where the bank line is money going out.
    const amount = isCard(name) ? -raw : raw;
    if (amount === 0) continue;

    const payee = cells.get("Name").trim();
    const description = cells.get("Description").trim();
    const kind = cells.get("Transaction type").trim();
    const number = cells.get("Num").trim();
    const split = cells.get("Split").trim();
    const id = accountId(name);

    transactions.push({
      id: "",
      occurrence: 1,
      date,
      amount,
      currency,
      serial: "",
      trn: "",
      particulars: description,
      code: number,
      reference: "",
      otherParty: payee || description,
      origin: "",
      type: kind,
      batch: "",
      otherPartyAccount: "",
      account: id,
      extras: { accountLabel: name },
      source: { importer: "quickbooks-ledger", file, line },
    } as Transaction);

    if (split !== "" && !unsplit.test(split)) {
      const code = options.codes?.get(split);
      const label = code !== undefined && code !== "" ? `${code} ${split}` : split;
      reference.push({
        date,
        amount,
        code: label,
        label,
        source: file,
        account: name,
        bankAccount: name,
        ...(payee !== "" ? { contact: payee } : {}),
        ...(description !== "" ? { description } : {}),
        ...(number !== "" ? { reference: number } : {}),
        bankFields: {
          ...(description !== "" ? { particulars: description } : {}),
          ...(number !== "" ? { code: number } : {}),
          ...(payee !== "" ? { otherParty: payee } : {}),
          ...(kind !== "" ? { type: kind } : {}),
        },
      } as ReferenceLine);
    }
  }

  return { transactions, reference, problems };
}
