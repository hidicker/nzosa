import type { Cents } from "./money.js";
import { parseAmount } from "./money.js";
import type { IsoDate } from "./dates.js";
import { daysBetween, parseDate } from "./dates.js";
import { findHeaderRow, parseCsvRecords } from "./csv.js";
import { ColumnReader } from "./importers/shared.js";
import type { Transaction } from "./types.js";

/**
 * Reconciling our own reporting against an accounting system's.
 *
 * The point of this project is that the bank statement, the user's coding and
 * the invoices are enough to produce the accounts. That claim is only worth
 * anything if it can be checked, which is what this does: line up what we
 * produce against what Xero produced for the same period, and show every
 * difference.
 *
 * Deliberately absent: any attempt to *explain* an unmatched line by searching
 * for a combination of other lines that sums to it. Once there are enough small
 * amounts to choose from, almost any total can be reached several ways, and a
 * coincidence is indistinguishable from a real match. Unmatched lines are shown
 * grouped by date and left for a person to read.
 */

export interface XeroEntry {
  date: IsoDate;
  /** The account section this row appeared under, verbatim. */
  account: string;
  contact: string;
  description: string;
  reference: string;
  /**
   * The invoice this row belongs to, when the export names one.
   *
   * A Stripe payout is three rows sharing a charge id, and only two of them
   * carry the invoice number -- but the group as a whole names it, which is
   * enough to tie the payout to the invoice it settled.
   */
  invoiceNumber: string;
  /**
   * The GST rate the accounting system put on the row, verbatim.
   *
   * Empty where there is none, which is itself the answer: a payment
   * processor's fee is charged from offshore and carries no New Zealand GST,
   * and assuming 15% on it understates the expense by exactly that.
   */
  gstRate: string;
  /** Xero's own name for what created the row, e.g. `Spend Money`. */
  source: string;
  /** The other side of the posting, as Xero names it. */
  relatedAccount: string;
  /**
   * Every account on the other side, not only the first.
   *
   * The rest is not detail. A bank row reading `200 - Sales, 820 - GST` is the
   * export saying that posting carried GST, and one reading `506 - Stripe
   * Fees` is saying the opposite -- which matters, because the GST Rate Name
   * column is filled in on the ledger row rather than the bank row, and the
   * ledger rows are not what this reads. Keeping only the first account threw
   * that answer away and left every payout part looking untaxed.
   */
  relatedAccounts: string[];
  /** Debit positive, credit negative, in minor units. */
  amount: Cents;
  /** Line in the source file, so a problem can be traced back. */
  line: number;
  /**
   * The rows this entry was built from, when several were grouped into one.
   *
   * Empty for an ordinary row.
   */
  members?: XeroEntry[];
}

export interface XeroImportResult {
  entries: XeroEntry[];
  problems: { message: string; line: number }[];
}

const REQUIRED = ["Date", "Source", "Description", "Debit", "Credit"];

/** Section headings that name a bank account rather than a ledger account. */
function isBankSection(name: string): boolean {
  return /\b(bank|bnz|anz|asb|westpac|kiwibank|visa|mastercard|card|account)\b/i.test(name);
}

/**
 * Read an Account Transactions export.
 *
 * The report is sectioned by account, each section introduced by a row with
 * only its first cell filled. Only bank sections are read here: every other
 * section is the other side of a posting that already appears in one.
 */
export function parseXeroAccountTransactions(text: string): XeroImportResult {
  const records = parseCsvRecords(text);
  const header = findHeaderRow(records, REQUIRED);

  if (!header) {
    return {
      entries: [],
      problems: [{ message: "Not an Account Transactions export: required columns missing.", line: 0 }],
    };
  }

  const reader = new ColumnReader(header.columns);
  const entries: XeroEntry[] = [];
  const problems: { message: string; line: number }[] = [];
  let section = "";

  for (let i = header.index + 1; i < records.length; i += 1) {
    const record = records[i];
    if (!record) continue;

    const first = record.fields[0]?.trim() ?? "";
    const filled = record.fields.filter((field) => field.trim() !== "");
    if (filled.length === 1 && first !== "") {
      section = first;
      continue;
    }
    const cells = reader.at(record.fields);

    // Two layouts come out of the same report. Run for one account it is
    // sectioned, each section introduced by a row with only its name in it;
    // run across the ledger it is flat, and every row names its own account
    // in a column. Reading only the sectioned one meant a flat export
    // produced no rows at all and an unhelpfully empty reconciliation.
    const named = cells.get("Account");
    const account = named !== "" ? named : section;

    // The name is what says "bank account", because the type column holds the
    // broad class -- Asset, Expense, Liability -- rather than a bank flag. The
    // class still rules things out: "Bank Fees" is named like a bank account
    // and is an Expense, while a real one is an Asset and a credit card a
    // Liability.
    const type = cells.get("Account Type");
    const couldBe = type === "" || /asset|liability|bank/i.test(type);
    if (!isBankSection(account) || !couldBe) continue;

    const date = parseDate(cells.get("Date"));
    if (date === null) continue;

    const debit = parseAmount(cells.get("Debit")) ?? 0;
    const credit = parseAmount(cells.get("Credit")) ?? 0;
    const amount = debit - credit;
    if (amount === 0) continue;

    entries.push({
      date,
      account,
      contact: cells.get("Contact"),
      description: cells.get("Description"),
      reference: cells.get("Reference"),
      invoiceNumber: cells.get("Invoice Number"),
      gstRate: cells.get("GST Rate Name"),
      source: cells.get("Source"),
      relatedAccount: cells.get("Related account").split(",")[0]?.trim() ?? "",
      relatedAccounts: cells
        .get("Related account")
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== ""),
      amount,
      line: record.line,
    });
  }

  return { entries, problems };
}

export interface XeroMatch {
  ours: Transaction;
  theirs: XeroEntry;
  /** Days between the two dates; non-zero is normal and not a problem. */
  drift: number;
}

/** A date on which the two sides do not agree, with both sides' rows. */
export interface XeroDayDifference {
  date: IsoDate;
  ours: Transaction[];
  theirs: XeroEntry[];
  /** Our total for the day minus theirs. Zero means the day agrees in total. */
  difference: Cents;
}

export interface XeroReconcileResult {
  matched: XeroMatch[];
  days: XeroDayDifference[];
  ourTotal: Cents;
  theirTotal: Cents;
  /** `ourTotal` minus `theirTotal`. Zero is a clean reconciliation. */
  difference: Cents;
}

export interface XeroReconcileOptions {
  /** How far apart the two dates may be and still be the same event. */
  windowDays?: number;
  /**
   * Combine bank rows that share a reference into the one event they describe.
   *
   * A Stripe payout reaches the bank as a single amount but is recorded as
   * three rows -- the invoice payment, the processing fee, and the customer's
   * reimbursement of that fee -- all carrying the same `ch_` charge id. The
   * shared reference is the accounting system's own statement that those rows
   * belong together, so grouping on it involves no inference at all. Without
   * it they are simply unmatched, and the alternative -- searching for a
   * combination that sums to the bank line -- finds coincidences.
   *
   * On by default. Pass `false` to compare row by row.
   */
  groupByReference?: boolean;
}

/**
 * Line up our transactions against Xero's for the same period.
 *
 * Matching is on exact amount within a date window, taking the closest date
 * first, and each row is used once. Anything left over is grouped by date so
 * the two sides of a day can be read together -- which is how a bank line that
 * Xero recorded as several postings shows up, without guessing at which
 * postings belong to it.
 */
export function reconcileAgainstXero(
  ours: readonly Transaction[],
  theirs: readonly XeroEntry[],
  options: XeroReconcileOptions = {},
): XeroReconcileResult {
  const windowDays = options.windowDays ?? 5;
  const candidates =
    options.groupByReference === false ? [...theirs] : groupByReference(theirs);

  const byAmount = new Map<Cents, XeroEntry[]>();
  for (const entry of candidates) {
    const list = byAmount.get(entry.amount);
    if (list) list.push(entry);
    else byAmount.set(entry.amount, [entry]);
  }

  const used = new Set<XeroEntry>();
  const matched: XeroMatch[] = [];
  const unmatchedOurs: Transaction[] = [];

  for (const transaction of [...ours].sort((a, b) => a.date.localeCompare(b.date))) {
    const possible = (byAmount.get(transaction.amount) ?? []).filter((e) => !used.has(e));

    let best: { drift: number; entry: XeroEntry } | undefined;
    for (const entry of possible) {
      const drift = daysBetween(transaction.date, entry.date);
      if (Math.abs(drift) > windowDays) continue;
      if (!best || Math.abs(drift) < Math.abs(best.drift)) best = { drift, entry };
    }

    if (best) {
      used.add(best.entry);
      matched.push({ ours: transaction, theirs: best.entry, drift: best.drift });
    } else {
      unmatchedOurs.push(transaction);
    }
  }

  const unmatchedTheirs = candidates.filter((entry) => !used.has(entry));

  const days = new Map<IsoDate, XeroDayDifference>();
  const dayFor = (date: IsoDate): XeroDayDifference => {
    let day = days.get(date);
    if (!day) {
      day = { date, ours: [], theirs: [], difference: 0 };
      days.set(date, day);
    }
    return day;
  };

  for (const transaction of unmatchedOurs) {
    const day = dayFor(transaction.date);
    day.ours.push(transaction);
    day.difference += transaction.amount;
  }
  for (const entry of unmatchedTheirs) {
    const day = dayFor(entry.date);
    day.theirs.push(entry);
    day.difference -= entry.amount;
  }

  const ourTotal = ours.reduce((sum, t) => sum + t.amount, 0);
  const theirTotal = candidates.reduce((sum, e) => sum + e.amount, 0);

  return {
    matched,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    ourTotal,
    theirTotal,
    difference: ourTotal - theirTotal,
  };
}

/**
 * Combine rows sharing a reference into the single event they describe.
 *
 * Only rows in the same account with the same non-empty reference are joined,
 * and only when there is more than one. The combined entry keeps its parts in
 * `members` so the detail is never lost, and takes its identity from the
 * largest part -- for a Stripe payout that is the invoice payment, which is the
 * useful thing to see beside the bank line.
 */
export function groupByReference(entries: readonly XeroEntry[]): XeroEntry[] {
  const groups = new Map<string, XeroEntry[]>();
  const singles: XeroEntry[] = [];

  for (const entry of entries) {
    const reference = entry.reference.trim();
    if (reference === "") {
      singles.push(entry);
      continue;
    }
    const key = JSON.stringify([entry.account, reference]);
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }

  const out = [...singles];
  for (const members of groups.values()) {
    const first = members[0];
    if (!first) continue;
    if (members.length === 1) {
      out.push(first);
      continue;
    }

    const amount = members.reduce((sum, m) => sum + m.amount, 0);
    const principal = members.reduce((a, b) => (Math.abs(b.amount) > Math.abs(a.amount) ? b : a));
    const date = members.reduce((a, b) => (b.date < a ? b.date : a), first.date);

    out.push({
      ...principal,
      date,
      amount,
      description: `${principal.description || principal.contact} (${members.length} postings)`,
      members: [...members],
    });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}
