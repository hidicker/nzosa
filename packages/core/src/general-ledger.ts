import type { Cents } from "./money.js";
import { formatAmount } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { PostedJournal } from "./posting.js";

/**
 * Every line the books are made of, flat.
 *
 * The account transactions report answers "what happened on this bank
 * account". This answers the other question, the one an accountant asks when
 * a figure looks wrong: what is this total actually made of, all of it, in one
 * list. One row per posting line rather than per bank line -- so a payment to
 * an accountant is three rows, the money out, the expense and the GST, and
 * they sum to nothing because that is what a balanced entry does.
 *
 * Nothing is derived here that is not already in the journals. This is the
 * same posting the profit and loss, the trial balance and the GST return are
 * built from, laid out one line to a row; if it disagrees with them, the
 * report is wrong rather than the books, and it can be read to find out why.
 * That is the point of it.
 */

export interface GeneralLedgerRow {
  date: IsoDate;
  /** What produced the entry: `bank`, `transfer`, `invoice`, `depreciation`. */
  source: string;
  /** The whole entry this line belongs to, so its siblings can be found. */
  journal: string;
  narration: string;
  accountCode: string;
  accountName: string;
  description: string;
  /** Positive, or zero when this line is the other way. */
  debit: Cents;
  credit: Cents;
  /** Signed: debit positive, credit negative. What the arithmetic uses. */
  amount: Cents;
  taxType: string;
  /** The GST-inclusive amount the tax was worked out from, where there is one. */
  taxBase: Cents | null;
  deductiblePercent: number | null;
}

export function generalLedgerRows(
  journals: readonly PostedJournal[],
): GeneralLedgerRow[] {
  const rows: GeneralLedgerRow[] = [];
  for (const journal of journals) {
    for (const line of journal.lines) {
      rows.push({
        date: journal.date,
        source: journal.source,
        journal: journal.transactionId,
        narration: journal.narration,
        accountCode: line.accountCode,
        accountName: line.accountName,
        description: line.description,
        debit: line.amount > 0 ? line.amount : 0,
        credit: line.amount < 0 ? -line.amount : 0,
        amount: line.amount,
        taxType: line.taxType,
        taxBase: line.taxBase ?? null,
        deductiblePercent: line.deductiblePercent ?? null,
      });
    }
  }
  // Date, then the entry, so the lines of one entry stay together and in the
  // order they were posted -- a journal read out of order is a puzzle.
  return rows.sort(
    (a, b) => a.date.localeCompare(b.date) || a.journal.localeCompare(b.journal),
  );
}

/**
 * What the whole listing comes to.
 *
 * Debits less credits, which is nought in a set of books that balances. It is
 * printed rather than assumed: a listing that does not add up is the one worth
 * knowing about, and the difference is the first thing to chase.
 */
export function generalLedgerTotals(rows: readonly GeneralLedgerRow[]): {
  debit: Cents;
  credit: Cents;
  difference: Cents;
} {
  let debit = 0;
  let credit = 0;
  for (const row of rows) {
    debit += row.debit;
    credit += row.credit;
  }
  return { debit, credit, difference: debit - credit };
}

const COLUMNS = [
  "Date",
  "Source",
  "Journal",
  "Narration",
  "Account Code",
  "Account",
  "Description",
  "Debit",
  "Credit",
  "Tax Type",
  "Tax Base",
  "Deductible %",
] as const;

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Money as a spreadsheet wants it: no thousands separator, two decimals. */
function plain(cents: Cents): string {
  return (cents / 100).toFixed(2);
}

export interface GeneralLedgerOptions {
  entity?: string;
  period?: { from: IsoDate; to: IsoDate };
}

export function formatGeneralLedger(
  journals: readonly PostedJournal[],
  options: GeneralLedgerOptions = {},
): string {
  const rows = generalLedgerRows(journals);
  const totals = generalLedgerTotals(rows);

  const lines: string[] = ["General Ledger"];
  if (options.entity !== undefined && options.entity !== "") lines.push(csvCell(options.entity));
  if (options.period !== undefined) {
    lines.push(csvCell(`For the period ${options.period.from} to ${options.period.to}`));
  }
  lines.push(COLUMNS.join(","));

  for (const row of rows) {
    lines.push(
      [
        row.date,
        row.source,
        row.journal,
        row.narration,
        row.accountCode,
        row.accountName,
        row.description,
        plain(row.debit),
        plain(row.credit),
        row.taxType,
        row.taxBase === null ? "" : plain(row.taxBase),
        row.deductiblePercent === null ? "" : String(row.deductiblePercent),
      ]
        .map(csvCell)
        .join(","),
    );
  }

  // The totals ride in the file, because a listing handed to somebody else has
  // to carry its own proof rather than rely on them adding it up again.
  lines.push(
    ["", "", "", "Totals", "", "", "", plain(totals.debit), plain(totals.credit), "", "", ""]
      .map(csvCell)
      .join(","),
  );
  lines.push(
    ["", "", "", `Debits less credits: ${formatAmount(totals.difference)}`, "", "", "", "", "", "", "", ""]
      .map(csvCell)
      .join(","),
  );

  return `${lines.join("\r\n")}\r\n`;
}
