import { findHeaderRow, parseCsvRecords } from "./csv.js";
import { isXeroBankAccountList } from "./xero-bank-accounts.js";
import { isAgedDetail } from "./opening-documents.js";
import { detect } from "./importers/index.js";
import { isGstReturnSummary } from "./gst-summary.js";
import { readIrdExport } from "./ird-records.js";
import { isQuickBooksChart, isQuickBooksLedger } from "./quickbooks.js";
import { isIif } from "./iif.js";
import { isSlowBooksLedger } from "./slowbooks.js";
import { isQuickBooksDesktopDetail } from "./qb-desktop-detail.js";
import { isQuickBooksExportJournal } from "./qbo-export.js";
import { isProductList } from "./product-lists.js";
import { isDueDateList } from "./document-dates.js";
import { isQuickBooksTrialBalance } from "./trial-balance.js";
import { isContactList } from "./contact-lists.js";

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
  | "bank-accounts"
  | "aged-detail"
  | "coding-sheet"
  | "gst-summary"
  | "ird-export"
  | "quickbooks-chart"
  | "quickbooks-ledger"
  | "quickbooks-iif"
  | "slowbooks-ledger"
  | "quickbooks-desktop-detail"
  | "quickbooks-export"
  | "product-list"
  | "due-dates"
  | "contact-list"
  | "not-needed"
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
  // A trial balance exported without its Account Class column. Last, so any
  // export above that also names an account and its type is taken as itself
  // first; the class is then worked out from the type (trial-balance.ts).
  {
    kind: "trial-balance",
    what: "trial balance",
    columns: ["Account Code", "Account", "Account Type"],
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
    const third = (record.fields[2] ?? "").trim();
    const money = /^-?[\d,]+\.\d{2}$/;
    // A date in the first column and a number in the second, which is what
    // every row of the body is -- or a currency between them, which is how
    // BNZ's export writes it: Date, CCY, Opening Balance, ... Closing Balance.
    // That shape was refused, so the drop zone called the file not recognised.
    const isDate = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(first);
    if (isDate && (money.test(second) || (/^[A-Z]{3}$/.test(second) && money.test(third)))) dated += 1;
  }
  return dated >= 3;
}

/**
 * A spreadsheet of past coding: dated amounts with what each was coded to.
 *
 * Usually a bank statement pasted into a workbook with a column added for the
 * coding, which is why it is asked before the bank statements: its first
 * columns are a statement's, and read as one it was imported as new bank lines
 * with the coding thrown away. `What` and `Coding` are headings no bank
 * writes, so they settle it there. `Account`, `Category` and `Class` are
 * looser -- a bank's export can carry an Account column -- so they count only
 * once nothing else has claimed the file.
 */
function codingColumns(text: string, headings: readonly string[]): boolean {
  const records = parseCsvRecords(text).slice(0, 25);
  return headings.some((heading) => findHeaderRow(records, ["Date", "Amount", heading]) !== null);
}

const CODING_SHEET = { kind: "coding-sheet", what: "coded spreadsheet" } as const;

/**
 * A QuickBooks Online report: the company, the report's name and its dates on
 * the first three rows, then the columns. `empty` when no row under the
 * columns holds anything but QuickBooks' own footer ("This report contains no
 * data.", "Accrual Basis ...").
 */
export function quickBooksReport(text: string): { title: string; empty: boolean } | null {
  const rows = parseCsvRecords(text.slice(0, 200000))
    .map((r) => r.fields.map((f) => f.trim()))
    .slice(0, 400);
  const cells = (row: readonly string[] | undefined): string[] => (row ?? []).filter((f) => f !== "");
  const title = cells(rows[1]).map((t) => t.replace(/\s+/g, " "));
  const dates = cells(rows[2]);
  if (title.length !== 1 || dates.length !== 1 || cells(rows[0]).length !== 1) return null;
  const said = dates[0] ?? "";
  const MONTH = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/;
  // QuickBooks writes the month first ("October 1-14, 2026", "As of October
  // 15, 2026"); Xero's reports, the same three rows, write the day first.
  const monthFirst = new RegExp(`^(?:As of )?${MONTH.source}\\s+\\d{1,2}\\b`);
  if (!(/\b\d{4}\b/.test(said) && monthFirst.test(said)) && !/^all dates$/i.test(said)) return null;
  const header = rows.findIndex((row, i) => i > 2 && cells(row).length >= 3);
  if (header < 0) return { title: title[0] ?? "", empty: true };
  const FOOTER = /contains no data|^(accrual|cash) basis\b|\bGMT\b/i;
  const empty = rows.slice(header + 1).every((row) => cells(row).every((cell) => FOOTER.test(cell)));
  return { title: title[0] ?? "", empty };
}

/**
 * Identify one export.
 *
 * `text` is the file as CSV -- a workbook having already been turned into one
 * by the caller, which is how every reader here takes them.
 */
export function identifyExport(text: string): Identified {
  // QuickBooks Online's own two exports. Before everything else: the general
  // ledger carries a date and an amount like any statement, and read as one it
  // would put every account's postings in as bank lines.
  // QuickBooks Desktop's IIF: tab-separated blocks that no other reader here
  // knows, holding the chart, the lists and every transaction at once.
  if (isIif(text)) {
    return { kind: "quickbooks-iif", what: "QuickBooks Desktop IIF file" };
  }
  // SlowBooks Pro's general ledger: one row a posting, with its source.
  if (isSlowBooksLedger(text)) {
    return { kind: "slowbooks-ledger", what: "SlowBooks general ledger" };
  }
  // QuickBooks Desktop's Transaction Detail by Account: every transaction,
  // under each account it touches.
  if (isQuickBooksDesktopDetail(text)) {
    return { kind: "quickbooks-desktop-detail", what: "QuickBooks Desktop transaction detail by account" };
  }
  // QuickBooks Online's Export data: its Journal, every transaction in blocks.
  if (isQuickBooksExportJournal(text)) {
    return { kind: "quickbooks-export", what: "QuickBooks Online journal, from Export data" };
  }
  // A QuickBooks report with nothing in it, or a sales report: nothing to
  // bring in. Asked first, as a sales report's columns are a ledger's too.
  const report = quickBooksReport(text);
  if (report !== null && report.empty) {
    return { kind: "not-needed", what: `QuickBooks ${report.title}, with nothing in it for the dates chosen` };
  }
  if (report !== null && /^sales by /i.test(report.title)) {
    return { kind: "not-needed", what: `QuickBooks ${report.title}: not needed, the general ledger holds every sale` };
  }
  // QuickBooks Online's trial balance: opening balances, as Xero's is.
  if (isQuickBooksTrialBalance(text)) return { kind: "trial-balance", what: "QuickBooks trial balance" };
  if (isQuickBooksChart(text)) {
    return { kind: "quickbooks-chart", what: "QuickBooks chart of accounts" };
  }
  if (isQuickBooksLedger(text)) {
    return { kind: "quickbooks-ledger", what: "QuickBooks general ledger" };
  }
  // A list of customers or vendors: names and details, and no dates or amounts.
  if (isContactList(text)) {
    return { kind: "contact-list", what: "customers or vendors" };
  }
  // Products and services, and when invoices and bills fall due: lists from
  // the system being left, read by their headings.
  if (isProductList(text)) return { kind: "product-list", what: "products and services" };
  if (isDueDateList(text)) return { kind: "due-dates", what: "invoices or bills with their due dates" };
  // Xero's list of its bank accounts, from the uncoded statement lines export.
  // Before the bank statements: its sections carry Date and Payee columns.
  if (isAgedDetail(text)) {
    return { kind: "aged-detail", what: "invoices or bills open at a date (aged detail)" };
  }
  if (isXeroBankAccountList(text)) {
    return { kind: "bank-accounts", what: "Xero's bank accounts and their numbers" };
  }

  if (codingColumns(text, ["What", "Coding"])) return { ...CODING_SHEET };

  // A bank statement first: its importers score themselves against their own
  // columns and are the most confident detectors here, and a bank CSV shares
  // no heading with any of the reports below.
  //
  // Except Xero's own report of a bank account: dropped among Xero's exports
  // it is the account transactions -- the coding to learn from -- and taken as
  // a bank statement it put Xero's copy of every bank line beside the bank
  // feed's. On Bank import, where it is chosen as bank lines, it is read so.
  const statement = detect(text);
  if (statement !== undefined && statement.importer !== "xero-bank") return { kind: "bank", what: "bank statement" };

  if (looksLikeDailyBalances(text)) {
    return { kind: "daily-balances", what: "daily bank balances" };
  }

  // myIR's summary of every return filed on a GST account, a row each.
  if (isGstReturnSummary(text)) {
    return { kind: "gst-summary", what: "GST return summary from myIR" };
  }

  // myIR's other exports: a tax account's transactions, or the employment
  // information summary. Each belongs to somebody, which is asked when it is
  // kept, on the Inland Revenue records page.
  const ird = readIrdExport(text).record;
  if (ird !== null && ird.kind !== "gst-returns") {
    return {
      kind: "ird-export",
      what: ird.kind === "account" ? `${ird.taxType || "tax"} account transactions from myIR` : "employment information from myIR",
    };
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

  if (codingColumns(text, ["Account", "Category", "Class"])) return { ...CODING_SHEET };

  return { kind: "unknown", what: "not recognised" };
}
