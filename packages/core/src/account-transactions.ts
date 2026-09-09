import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Transaction } from "./types.js";
import type { GstClassification, GstResolver } from "./gst.js";
import { gstWithin } from "./reports.js";

/**
 * Every coded line, written the way an accounting system writes it.
 *
 * The books this produces have to be checkable by somebody who has never seen
 * this program. An accountant asked for "the account transactions report" gets
 * one shape back, whatever system it came from, and can read it without being
 * taught anything -- which is what this writes: the same columns, the same
 * words for the same GST rates, the bank account in the Account column and the
 * coding in Related account.
 *
 * It is also the file this project reads back in. The Check page compares our
 * coding against an accounting system's export of exactly this report, so a
 * ledger can be exported, handed over, corrected, and read again, and the
 * comparison means the same thing in both directions.
 *
 * What it is not is a posting engine. One row per line of the bank statement,
 * or per part where a line was split, with the account it was coded to beside
 * it. The double entry lives in the journal report, which is a different
 * question and a different export.
 */

export interface AccountTransactionRow {
  date: IsoDate;
  /** `Receive Money` or `Spend Money`, as the sign decides. */
  source: string;
  contact: string;
  description: string;
  invoiceNumber: string;
  reference: string;
  /** Signed: money in is positive. */
  gross: Cents;
  net: Cents;
  gst: Cents;
  /** `15` or `0`. */
  gstRate: number;
  gstRateName: string;
  /** The bank account this arrived on, named as a person would recognise it. */
  account: string;
  /** The account it was coded to, e.g. `730 - Roasting Equipment`. */
  relatedAccount: string;
}

/**
 * The line that says this file came from here.
 *
 * Every row in this export is a line of a bank statement, so its Account
 * column is always a bank account. An accounting system's version of the same
 * report is not necessarily that, and the reader tells the two apart by the
 * account's name -- which works on "BNZ 01" and does not work on "Kea Coffee
 * Roasters", so our own file failed to read back. Rather than loosen the test
 * for every file, and risk reading somebody's expense accounts as bank
 * accounts, the file says what it is and only ours is trusted about it.
 *
 * A spreadsheet ignores it as one more title line, which is what it is.
 */
export const EXPORT_MARK = "Exported by NZOSA";

export interface AccountTransactionsOptions {
  /** Whose books these are, for the title line. */
  entity?: string;
  /** What the report covers, for the title line. Both ends inclusive. */
  period?: { from: IsoDate; to: IsoDate };
  /** The account a transaction was coded to, or "" when nothing has coded it. */
  codeOf: (transaction: Transaction) => string;
  /** How the transaction is treated for GST. */
  classify: GstResolver;
  /** The bank account's name as a person would recognise it. */
  accountName?: (id: string) => string;
  /** The invoice a receipt settled, when one is known. */
  invoiceOf?: (transaction: Transaction) => string;
  /** The chart account GST is posted to, named as the chart names it. */
  gstAccount?: string;
}

/**
 * Xero's own wording for a rate, because the file is read by people and
 * programs that already know these names. Ours would mean re-teaching both.
 */
export function gstRateName(classification: GstClassification): string {
  if (classification.side === "imports") return "GST on Imports";
  if (classification.treatment === "zero-rated") return "Zero Rated";
  if (classification.treatment === "exempt") return "Exempt";
  if (classification.treatment === "out-of-scope") return "No GST";
  if (classification.side === "none") return "No GST";
  return classification.side === "sales" ? "15% GST on Income" : "15% GST on Expenses";
}

const COLUMNS = [
  "Date",
  "Source",
  "Contact",
  "Contact Group",
  "Description",
  "Invoice Number",
  "Reference",
  "Debit",
  "Credit",
  "Gross",
  "Net",
  "GST",
  "GST Rate",
  "GST Rate Name",
  "Account Code",
  "Account",
  "Account Type",
  "Related account",
] as const;

/** The rows behind the report, before they are written out. */
export function accountTransactionRows(
  transactions: readonly Transaction[],
  options: AccountTransactionsOptions,
): AccountTransactionRow[] {
  const name = options.accountName ?? ((id: string) => id);
  const gstAccount = options.gstAccount ?? "820 - GST";

  return [...transactions]
    .sort((a, b) => a.date.localeCompare(b.date) || a.account.localeCompare(b.account))
    .map((transaction) => {
      const classification = options.classify(transaction);
      const percent = classification.deductiblePercent ?? 100;
      // Half-deductible entertainment claims half the GST. The cost is still
      // the whole cost: only the tax is apportioned.
      const gst = Math.round((gstWithin(transaction.amount, classification) * percent) / 100);
      const code = options.codeOf(transaction);
      const rate =
        classification.treatment === "standard" && classification.side !== "none" ? 15 : 0;

      return {
        date: transaction.date,
        source: transaction.amount >= 0 ? "Receive Money" : "Spend Money",
        contact: transaction.otherParty,
        description: transaction.particulars || transaction.reference || transaction.otherParty,
        invoiceNumber: options.invoiceOf?.(transaction) ?? "",
        reference: transaction.reference,
        gross: transaction.amount,
        net: transaction.amount - gst,
        gst,
        gstRate: rate,
        gstRateName: gstRateName(classification),
        account: name(transaction.account),
        // Both sides, the way the report shows them: what it was coded to, and
        // the GST account when any GST was involved. A line with no code says
        // so rather than appearing to have been coded to nothing.
        relatedAccount:
          code === ""
            ? "(not coded)"
            : gst !== 0
              ? `${code}, ${gstAccount}`
              : code,
      };
    });
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Money as the report writes it: four decimals, unsigned in Debit and Credit. */
function amount(cents: Cents): string {
  return (cents / 100).toFixed(4);
}

export function formatAccountTransactions(
  transactions: readonly Transaction[],
  options: AccountTransactionsOptions,
): string {
  const rows = accountTransactionRows(transactions, options);
  const lines: string[] = ["Account Transactions", EXPORT_MARK];
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
        row.contact,
        "",
        row.description,
        row.invoiceNumber,
        row.reference,
        amount(row.gross > 0 ? row.gross : 0),
        amount(row.gross < 0 ? -row.gross : 0),
        amount(row.gross),
        amount(row.net),
        amount(row.gst),
        String(row.gstRate),
        row.gstRateName,
        "",
        row.account,
        "Asset",
        row.relatedAccount,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  return `${lines.join("\r\n")}\r\n`;
}
