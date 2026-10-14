import { findHeaderRow, parseCsvRecords } from "./csv.js";
import { parseDate } from "./dates.js";
import { parseAmount } from "./money.js";
import { ColumnReader } from "./importers/shared.js";
import type { Account } from "./chart.js";
import type { ReferenceLine } from "./coding-check.js";
import type { IsoDate } from "./dates.js";
import type { Cents } from "./money.js";
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
  /** Whether a debit raises it: assets, cost of sales and expenses. */
  debit: boolean;
}

function placementOf(type: string, detail: string): Placement {
  const place = placeOf(type, detail);
  const t = type.toLowerCase();
  const debit =
    t === "bank" ||
    t.startsWith("accounts receivable") ||
    t === "other current assets" ||
    t === "fixed assets" ||
    t === "other assets" ||
    t === "cost of goods sold" ||
    t === "expenses" ||
    t === "other expense";
  return { ...place, debit };
}

function placeOf(type: string, detail: string): Omit<Placement, "debit"> {
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
  /** Names of the accounts a debit raises (assets, cost of sales, expenses). */
  debitNormal: string[];
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
  const debitNormal: string[] = [];
  if (header === null) return { accounts, debitNormal, bankNames, cardNames };
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
    if (place.debit) debitNormal.push(name);
    if (place.bank) bankNames.push(name);
    if (place.card) cardNames.push(name);
  }
  return { accounts, debitNormal, bankNames, cardNames };
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

    // Money moved between two of its own accounts is a transfer, not coding:
    // the other account is a bank account, which no line is coded to.
    if (split !== "" && !unsplit.test(split) && !isBank(split)) {
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

export interface QuickBooksLeg {
  /** The account's whole name in the chart, `Landscaping Services:Labor`. */
  account: string;
  /** Debit positive, credit negative. */
  debit: Cents;
}

/** One entry as QuickBooks posted it: every account it touched, gathered from the report's sections. */
export interface QuickBooksEntry {
  date: IsoDate;
  type: string;
  num: string;
  name: string;
  memo: string;
  legs: QuickBooksLeg[];
}

export interface QuickBooksEntries {
  entries: QuickBooksEntry[];
  problems: ImportProblem[];
}

/**
 * Every posting in the general ledger, gathered back into the entries they
 * came from.
 *
 * The report lists postings under each account, so an invoice appears once
 * under receivables and once under the income it was for. Put back together
 * by date, type, number and name, they are balanced entries -- which is what
 * the bank lines alone cannot give: invoices, bills, credit memos, journal
 * entries and stock adjustments touch no bank account at all.
 *
 * A sub-account's section is headed by its own name only, so the whole name
 * is rebuilt from the nesting of the headings and their totals.
 */
export function parseQuickBooksEntries(text: string, chart: QuickBooksChart, options: QuickBooksLedgerOptions = {}): QuickBooksEntries {
  const records = parseCsvRecords(text);
  const header = findHeaderRow(records, LEDGER_COLUMNS, 12);
  const entries: QuickBooksEntry[] = [];
  const problems: ImportProblem[] = [];
  if (header === null) return { entries, problems };

  const currency = options.currency ?? "USD";
  const reader = new ColumnReader(header.columns);
  const known = new Set(chart.accounts.map((a) => a.name));
  const debitNormal = new Set(chart.debitNormal);
  const dayFirst = dateOrderOf(records, header.index, reader) ?? options.dayFirst ?? false;
  const byLeaf = new Map<string, string[]>();
  for (const name of known) {
    const leaf = name.split(":").pop() ?? name;
    byLeaf.set(leaf, [...(byLeaf.get(leaf) ?? []), name]);
  }

  const stack: string[] = [];
  const groups = new Map<string, QuickBooksEntry>();

  const body = records.slice(header.index + 1);
  // A heading has nothing else on its row; a total carries the figure.
  const isHeading = (row: { fields: readonly string[] } | undefined): string => {
    const first = (row?.fields[0] ?? "").trim();
    if (row === undefined || first === "") return "";
    return /^Total for /.test(first) || row.fields.slice(1).every((cell) => cell.trim() === "") ? first : "";
  };
  /**
   * Whether an account that has just been totalled goes on to its sub-accounts.
   * An account with postings of its own is totalled, then each sub-account
   * follows, then "Total for X with sub-accounts" closes the lot; one with
   * none goes straight to that last total.
   */
  const hasChildren = (from: number, name: string): boolean => {
    for (let j = from; j < body.length; j += 1) {
      const heading = isHeading(body[j]);
      if (heading === `Total for ${name} with sub-accounts`) return true;
      if (heading === name) return false;
    }
    return false;
  };

  for (let index = 0; index < body.length; index += 1) {
    const record = body[index];
    if (record === undefined) continue;
    const { fields, line } = record;
    const first = isHeading(record);
    if (first !== "") {
      // A section heading, or the total that closes one.
      const closing = /^Total for (.+?)( with sub-accounts)?$/.exec(first);
      if (closing !== null) {
        const name = closing[1] ?? "";
        const at = stack.lastIndexOf(name);
        const whole = closing[2] !== undefined;
        if (at >= 0 && (whole || !hasChildren(index + 1, name))) stack.length = at;
      } else {
        stack.push(first);
      }
      continue;
    }
    const cells = reader.at(fields);
    const leaf = cells.get("Distribution account").trim();
    if (leaf === "") continue;
    const dateText = cells.get("Transaction date");
    const date = parseDate(dateText, { dayFirst });
    if (date === null) continue;
    const raw = parseAmount(cells.get("Amount") || "0", currency);
    if (raw === null) {
      problems.push({ line, row: [...fields], message: `Unreadable amount ${JSON.stringify(cells.get("Amount"))}` });
      continue;
    }

    // The whole name: the headings above, if the chart has it; else the only
    // account with that last part.
    const path = stack.join(":");
    let account = known.has(path) ? path : "";
    if (account === "") {
      const options2 = byLeaf.get(leaf) ?? [];
      if (options2.length === 1) account = options2[0] ?? "";
      else if (known.has(leaf)) account = leaf;
    }
    if (account === "") {
      problems.push({ line, row: [...fields], message: `Account "${leaf}" is not in the chart` });
      continue;
    }

    const type = cells.get("Transaction type").trim();
    const num = cells.get("Num").trim();
    const name = cells.get("Name").trim();
    const memo = cells.get("Description").trim();
    // A debit is what raises an account that debits raise; what raises one
    // that credits raise is a credit.
    const debit = debitNormal.has(account) ? raw : -raw;
    const key = `${date}\u0000${type}\u0000${num}\u0000${name}`;
    let entry = groups.get(key);
    if (entry === undefined) {
      entry = { date, type, num, name, memo, legs: [] };
      groups.set(key, entry);
      entries.push(entry);
    }
    if (entry.memo === "" && memo !== "") entry.memo = memo;
    entry.legs.push({ account, debit });
  }
  return { entries, problems };
}

export interface QuickBooksSplit {
  /** The bank or card line, as returned in `transactions`. */
  transaction: Transaction;
  /** Each account the entry went to, signed in the direction of the line. */
  parts: { code: string; amount: Cents; note: string }[];
}

export interface QuickBooksJournal {
  date: IsoDate;
  narration: string;
  lines: { code: string; amount: Cents; description?: string }[];
}

export interface QuickBooksBooks {
  /** Pairs of lines that are one movement between the books' own accounts. */
  transfers: [Transaction, Transaction][];
  /** Bank and card lines. */
  transactions: Transaction[];
  /** What each was coded to, for the coding check and for rules. */
  reference: ReferenceLine[];
  /** Entries that went to several accounts at once, to split the line the same way. */
  splits: QuickBooksSplit[];
  /** Entries that touch no bank or card account: invoices, bills, credit memos, journal entries. */
  journals: QuickBooksJournal[];
  problems: ImportProblem[];
}

/**
 * Everything the general ledger holds, as this app keeps it.
 *
 * Bank and card postings become bank lines (with the coding as reference
 * lines, and a split where QuickBooks spread the entry over several
 * accounts); every entry that touches no bank account becomes a journal. The
 * two together carry every posting, so the profit and loss and the balance
 * sheet come out as QuickBooks has them.
 */
export function parseQuickBooksBooks(text: string, chart: QuickBooksChart, options: QuickBooksLedgerOptions = {}): QuickBooksBooks {
  const codes = options.codes ?? new Map(chart.accounts.map((a) => [a.name, a.code]));
  const ledger = parseQuickBooksLedger(text, {
    ...options,
    bankNames: chart.bankNames,
    cardNames: chart.cardNames,
    codes,
  });
  const parsed = parseQuickBooksEntries(text, chart, options);
  const banks = new Set(chart.bankNames);
  const label = (name: string): string => {
    const code = codes.get(name) ?? "";
    return code === "" ? name : `${name} - ${code}`;
  };

  const journals: QuickBooksJournal[] = [];
  const splits: QuickBooksSplit[] = [];
  const transfers: [Transaction, Transaction][] = [];
  const reference: ReferenceLine[] = [...ledger.reference];
  const problems: ImportProblem[] = [...ledger.problems, ...parsed.problems];

  for (const entry of parsed.entries) {
    const bankLegs = entry.legs.filter((leg) => banks.has(leg.account));
    const others = entry.legs.filter((leg) => !banks.has(leg.account));
    const named = `${entry.type}${entry.num !== "" ? ` ${entry.num}` : ""}${entry.name !== "" ? `, ${entry.name}` : ""}`;
    if (bankLegs.length === 0) {
      const sum = entry.legs.reduce((total, leg) => total + leg.debit, 0);
      if (sum !== 0) {
        problems.push({ line: 0, row: [], message: `${entry.date} ${named} does not balance and was left out` });
        continue;
      }
      // One line to an account, so an invoice for three items shows as three.
      journals.push({
        date: entry.date,
        narration: `From QuickBooks: ${named}`,
        lines: entry.legs.map((leg) => ({
          code: label(leg.account),
          amount: leg.debit,
          ...(entry.memo !== "" ? { description: entry.memo } : {}),
        })),
      });
      continue;
    }
    // Two bank or card accounts, nothing else: money moved between them.
    if (bankLegs.length === 2 && others.length === 0) {
      const [a, b] = bankLegs;
      if (a !== undefined && b !== undefined && a.account !== b.account && a.debit === -b.debit) {
        const find = (leg: QuickBooksLeg) =>
          ledger.transactions.find(
            (x) => x.date === entry.date && x.account === accountId(leg.account) && x.amount === leg.debit && x.type === entry.type && x.code === entry.num,
          );
        const ta = find(a);
        const tb = find(b);
        if (ta !== undefined && tb !== undefined) transfers.push([ta, tb]);
      }
      continue;
    }
    // Where the report states no account on the bank's side -- a sales tax
    // payment is "Split: blank" -- the other legs say it: one account takes
    // the lot, so every bank line of the entry was coded to it.
    const accountsOut = new Set(others.map((leg) => leg.account));
    // Several bank lines and several accounts in one entry (two sales tax
    // payments made together): each bank line goes to the account whose leg
    // is the same amount the other way round.
    if (bankLegs.length >= 2 && accountsOut.size >= 2) {
      const free = [...others];
      for (const leg of bankLegs) {
        const at = free.findIndex((o) => o.debit === -leg.debit);
        if (at < 0) continue;
        const target = free.splice(at, 1)[0]?.account ?? "";
        const id = accountId(leg.account);
        const t = ledger.transactions.find(
          (x) => x.date === entry.date && x.account === id && x.amount === leg.debit && x.type === entry.type && x.code === entry.num,
        );
        const said = reference.some((r) => r.date === entry.date && r.amount === leg.debit && r.bankAccount === leg.account);
        if (t !== undefined && !said) {
          const code = label(target);
          reference.push({
            date: entry.date,
            amount: leg.debit,
            code,
            label: code,
            source: options.file ?? "general-ledger.csv",
            account: leg.account,
            bankAccount: leg.account,
            ...(entry.name !== "" ? { contact: entry.name } : {}),
            ...(entry.memo !== "" ? { description: entry.memo } : {}),
          } as ReferenceLine);
        }
      }
    }
    if (accountsOut.size === 1) {
      const target = others[0]?.account ?? "";
      for (const leg of bankLegs) {
        const id = accountId(leg.account);
        const t = ledger.transactions.find(
          (x) => x.date === entry.date && x.account === id && x.amount === leg.debit && x.type === entry.type && x.code === entry.num,
        );
        const said = ledger.reference.some((r) => r.date === entry.date && r.amount === leg.debit && r.bankAccount === leg.account);
        if (t !== undefined && !said) {
          const code = label(target);
          reference.push({
            date: entry.date,
            amount: leg.debit,
            code,
            label: code,
            source: options.file ?? "general-ledger.csv",
            account: leg.account,
            bankAccount: leg.account,
            ...(entry.name !== "" ? { contact: entry.name } : {}),
            ...(entry.memo !== "" ? { description: entry.memo } : {}),
          } as ReferenceLine);
        }
      }
    }
    // One bank line spread over several accounts: split it the same way.
    const only = bankLegs.length === 1 ? bankLegs[0] : undefined;
    if (only !== undefined && others.length >= 2) {
      const accountId2 = accountId(only.account);
      const found = ledger.transactions.find(
        (t) =>
          t.date === entry.date &&
          t.account === accountId2 &&
          t.amount === only.debit &&
          t.type === entry.type &&
          t.code === entry.num,
      );
      if (found !== undefined) {
        splits.push({
          transaction: found,
          // The part's amount is in the line's direction: what the other
          // legs take, turned round.
          parts: others.map((leg) => ({ code: label(leg.account), amount: -leg.debit, note: entry.memo || named })),
        });
      }
    }
  }
  return { transactions: ledger.transactions, reference, splits, transfers, journals, problems };
}

/**
 * The chart as the chart export gave it, rebuilt from the accounts held in
 * the books -- for a ledger dropped later, or on another day.
 */
export function quickBooksChartFrom(accounts: readonly Account[]): QuickBooksChart {
  const debit = new Set(["Bank", "Accounts Receivable", "Current Asset", "Fixed Asset", "Non-current Asset", "Direct Costs", "Overhead", "Expense"]);
  return {
    accounts: [...accounts],
    debitNormal: accounts.filter((a) => debit.has(a.type)).map((a) => a.name),
    bankNames: accounts.filter((a) => a.type === "Bank").map((a) => a.name),
    cardNames: accounts.filter((a) => a.type === "Bank" && a.description === "Credit Card").map((a) => a.name),
  };
}
