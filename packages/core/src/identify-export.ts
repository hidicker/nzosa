import { findHeaderRow, parseCsvRecords } from "./csv.js";
import { detect } from "./importers/index.js";

/**
 * What kind of export a file is, worked out from its columns.
 *
 * Setting a set of books up means seven separate errands: the chart, the
 * account transactions, the journal report, the assets, the invoices, the
 * filed returns, the bank statements -- each fetched from the same system on
 * the same visit, and each then loaded on a different page of this app,
 * through a different button, in an order nobody is told. Most of the setting
 * up is not work, it is navigation.
 *
 * None of that is necessary. Every one of these reports announces itself in
 * its own heading row, and the parsers already know those headings because
 * each of them checks for its own before reading a line. This puts that
 * knowledge in one place so a person can hand over whatever they have and be
 * told what it was.
 *
 * Guessing wrongly here is worse than not guessing. A file that matches
 * nothing is reported as unknown rather than pushed through the closest
 * parser: loading a journal report as a chart of accounts would not fail, it
 * would quietly produce nonsense.
 */

export type ExportKind =
  | "bank"
  | "chart"
  | "account-transactions"
  | "journal-report"
  | "general-ledger-detail"
  | "trial-balance"
  | "fixed-assets"
  | "invoices"
  | "daily-balances"
  | "gst-return"
  | "unknown";

export interface Identified {
  kind: ExportKind;
  /** What to call it when telling somebody what was loaded. */
  what: string;
  /**
   * A second use for the same file.
   *
   * An Account Transactions export is two things at once: the coding to check
   * ours against, and -- because a payment appears twice in it, once against
   * the receivable and once against the bank -- the record of which receipt
   * settled which invoice. Loading it once and using it for both is the whole
   * reason that report is worth asking for.
   */
  alsoUseFor?: "allocations";
}

/** The heading rows each report is recognised by. */
const SIGNATURES: { kind: ExportKind; what: string; columns: string[] }[] = [
  // Most specific first. An Account Transactions export carries Description
  // *and* Reference, so a signature written around Reference alone would claim
  // it; the journal report carries a Journal ID that nothing else does.
  { kind: "fixed-assets", what: "fixed asset register", columns: ["*AssetName", "*AssetNumber"] },
  { kind: "chart", what: "chart of accounts", columns: ["*Code", "*Name", "*Type"] },
  // A trial balance names an Account Class, which nothing else here does. It
  // was missing altogether, so the one file the opening balances need was the
  // one file the drop zone refused -- and the page that does accept it is
  // reached by a button somebody has to already know about.
  {
    kind: "trial-balance",
    what: "trial balance",
    columns: ["Account Code", "Account", "Account Type", "Account Class"],
  },
  {
    kind: "invoices",
    what: "invoices",
    columns: ["InvoiceNumber", "InvoiceDate", "Total", "LineAmount", "AccountCode"],
  },
  // Before the journal report, which it would otherwise be taken for: it
  // carries a Journal ID and the same Date/Account/Debit/Credit. What tells
  // them apart is that this one values every line -- gross, tax and net -- and
  // the journal report does not. They are not interchangeable in the other
  // direction either: this one has no Narration column, and a narration is how
  // a manual year-end journal is told from an ordinary posting.
  {
    kind: "general-ledger-detail",
    what: "general ledger detail",
    columns: ["Journal ID", "Gross", "Net", "GST Rate Name"],
  },
  {
    kind: "journal-report",
    what: "journal report",
    columns: ["Date", "Journal ID", "Account", "Debit", "Credit"],
  },
  {
    kind: "account-transactions",
    what: "account transactions",
    columns: ["Date", "Source", "Description", "Debit", "Credit"],
  },
];

/**
 * A daily balance export, which has no heading row to find.
 *
 * It is a run of sections, each an account name followed by a date and a
 * balance per business day, so it is recognised by that shape rather than by a
 * heading. Checked before the signatures because it has none of their columns
 * and would otherwise fall through to unknown.
 */
function looksLikeDailyBalances(text: string): boolean {
  const records = parseCsvRecords(text).slice(0, 40);
  let dated = 0;
  for (const record of records) {
    const first = (record.fields[0] ?? "").trim();
    const second = (record.fields[1] ?? "").trim();
    // A date in the first column and a number in the second, which is what
    // every row of the body is.
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(first) && /^-?[\d,]+\.\d{2}$/.test(second)) dated += 1;
  }
  return dated >= 3;
}

/**
 * Identify one export.
 *
 * `text` is the file as CSV -- a workbook having already been turned into one
 * by the caller, which is how every reader here takes them.
 */
export function identifyExport(text: string): Identified {
  // A bank statement first: its importers score themselves against their own
  // columns and are the most confident detectors here, and a bank CSV shares
  // no heading with any of the reports below.
  if (detect(text) !== undefined) return { kind: "bank", what: "bank statement" };

  if (looksLikeDailyBalances(text)) {
    return { kind: "daily-balances", what: "daily bank balances" };
  }

  // A filed GST return is a form rather than a table: no heading row, just a
  // column of box numbers down the sheet. Those are what it is recognised by,
  // and nothing else here prints "Box 5" beside "Box 8".
  if (/\bBox 5\b/.test(text) && /\bBox 8\b/.test(text) && /\bBox 12\b/.test(text)) {
    return { kind: "gst-return", what: "a filed GST return" };
  }

  const records = parseCsvRecords(text);
  for (const signature of SIGNATURES) {
    if (findHeaderRow(records, signature.columns) === null) continue;
    return signature.kind === "account-transactions"
      ? { kind: signature.kind, what: signature.what, alsoUseFor: "allocations" }
      : { kind: signature.kind, what: signature.what };
  }

  return { kind: "unknown", what: "not recognised" };
}
