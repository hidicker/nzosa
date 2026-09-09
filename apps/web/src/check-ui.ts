import {
  compareCodings,
  inferAccountMapping,
  parseAccountTransactionsSheet,
  parseChartOfAccounts,
  parseXeroAllocations,
  parseXeroAccountTransactions,
  payoutGroups,
  parseReconciledCsv,
  parseReconciledSheet,
  readSheetColumns,
  sheetHeadings,
  parseXeroJournalReport,
  csvToSheet,
  decodeText,
  EXPORT_MARK,
  readXlsx,
  referenceFromJournals,
  sheetToCsv,
} from "@nzosa/core";
import type {
  Account,
  Journal,
  JournalLine,
  Payout,
  PaymentAllocation,
  ReferenceLine,
  SheetColumns,
  SheetRows,
} from "@nzosa/core";

/** Read a sheet whose columns were pointed out by hand. */
export function readChosenColumns(
  sheet: SheetRows,
  columns: SheetColumns,
  source: string,
): ReferenceLine[] {
  return readSheetColumns(sheet, columns, source);
}

/**
 * Reading a reference source, whichever kind it is.
 *
 * The business is split between two systems -- Xero for the trading company,
 * the workbook for the properties -- so the check has to accept either without
 * being told which. The file itself says: a Journal Report has journal columns,
 * a workbook has a reconciled sheet.
 */

const BANKISH = /\b(bnz|visa|paypal|stripe|wise|anz|asb|kiwibank|westpac)\b/i;
const STRUCTURAL = new Set(["GST", "Accounts Receivable", "Accounts Payable", "Rounding"]);

const isBankLine = (line: JournalLine): boolean =>
  line.accountCode === "" && BANKISH.test(line.accountName);

const isStructural = (line: JournalLine): boolean => STRUCTURAL.has(line.accountName);

export interface ReferenceLoad {
  lines: ReferenceLine[];
  chart: Account[];
  problems: string[];
  /**
   * Payment allocations found in the same file.
   *
   * An Account Transactions export already says which receipt settled which
   * invoice -- every payment is in there twice, and the bank side names the
   * invoice. Asking for a second, separate export of the same report to learn
   * the same thing was work for no reason.
   */
  allocations: PaymentAllocation[];
  /**
   * Journals read from these files.
   *
   * Handed back so a journal report dropped here is kept rather than used
   * once and forgotten: it is the only file that says which postings belong
   * to which payment, and the next export loaded will want it.
   */
  journals: Journal[];
  /**
   * Payment-processor payouts found in the same file.
   *
   * One bank line that is really an invoice payment, a surcharge and a fee,
   * tied together by the processor's charge id. Read here because the export
   * is the only place all three appear on the same row as that id.
   */
  payouts: Payout[];
  /**
   * Files that hold a table but not one this could name.
   *
   * A spreadsheet is somebody's own and its headings are whatever they chose,
   * so guessing will not always work. Rather than refuse the file, it is handed
   * back with its headings so the columns can be pointed out by hand.
   */
  unreadable: { name: string; sheet: SheetRows; headings: { index: number; name: string }[] }[];
}

/** Decode text that may be Windows-1252 rather than UTF-8. */
async function readText(file: File): Promise<string> {
  // Xero's CSV exports are Windows-1252, and one en dash is enough to make a
  // UTF-8 read produce nonsense. `decodeText` tries UTF-8 strictly and falls
  // back, mapping the range that separates Windows-1252 from Latin-1 itself
  // rather than trusting the runtime to.
  return decodeText(new Uint8Array(await file.arrayBuffer()));
}

/**
 * Read every reference source that was handed over.
 *
 * Two passes, because one file answers a question another one asks. An
 * Account Transactions export groups the rows of a payment by contact and
 * date, which two payments to one payee on the same day both satisfy; the
 * journal report has a journal id per payment and no GST rate at all. Read
 * alone, each loses something. Read together, the journal says which rows go
 * with which payment and the export says what each row was and at what rate.
 *
 * So the journals are gathered first, from these files and from whatever the
 * ledger already holds, and the exports are read knowing them.
 */
export async function loadReference(
  files: readonly File[],
  options: { journals?: readonly Journal[] } = {},
): Promise<ReferenceLoad> {
  const lines: ReferenceLine[] = [];
  const chart: Account[] = [];
  const problems: string[] = [];
  const allocations: PaymentAllocation[] = [];
  const unreadable: ReferenceLoad["unreadable"] = [];
  const journals: Journal[] = [];
  const payouts: Payout[] = [];

  // Pass one. Each file is decoded once and kept, both to avoid reading a
  // workbook twice and because the second pass needs the journals from all of
  // them before it reads any export.
  interface Prepared {
    file: File;
    workbook?: Awaited<ReturnType<typeof readXlsx>>;
    text?: string;
    failed?: string;
  }
  const prepared: Prepared[] = [];
  for (const file of files) {
    try {
      if (/\.xlsx$/i.test(file.name)) {
        prepared.push({ file, workbook: await readXlsx(new Uint8Array(await file.arrayBuffer())) });
      } else {
        prepared.push({ file, text: await readText(file) });
      }
    } catch (error) {
      prepared.push({ file, failed: (error as Error).message });
    }
  }

  for (const one of prepared) {
    // A journal report in either shape. Checked before anything else claims
    // the file: an Account Transactions export carries no Journal ID column,
    // so this cannot take one by mistake.
    const asText =
      one.text ??
      (one.workbook?.sheets[0] !== undefined ? sheetToCsv(one.workbook.sheets[0]) : undefined);
    if (asText === undefined) continue;
    const read = parseXeroJournalReport(asText);
    if (read.journals.length > 0) journals.push(...read.journals);
  }

  // The ledger's own journals count too, so an export loaded today is read
  // with the journal report loaded last week.
  const known = journals.length > 0 ? journals : [...(options.journals ?? [])];
  const sheetOptions = known.length > 0 ? { journals: known } : {};

  // Pass two: what each file is for.
  for (const one of prepared) {
    const file = one.file;
    try {
      if (one.failed !== undefined) throw new Error(one.failed);
      if (one.workbook !== undefined) {
        const workbook = one.workbook;
        // Two workbook shapes are accepted, and the file says which it is: an
        // Account Transactions export has an Account column, the working
        // spreadsheet has a reconciled sheet.
        // The same sheet, read for what settled what.
        const firstSheet = workbook.sheets[0];
        if (firstSheet !== undefined) {
          const asCsv = sheetToCsv(firstSheet);
          allocations.push(...parseXeroAllocations(asCsv).allocations);
          payouts.push(...payoutGroups(parseXeroAccountTransactions(asCsv).entries));
        }

        // A journal report saved as a workbook, which is how Xero offers it.
        // Its rows were already read for their journals in pass one; this turns
        // them into reference lines, so dropping one here is not a file that
        // "could not be read".
        if (firstSheet !== undefined) {
          const report = parseXeroJournalReport(sheetToCsv(firstSheet));
          if (report.journals.length > 0) {
            lines.push(
              ...referenceFromJournals(report.journals, isBankLine, isStructural, file.name),
            );
            continue;
          }
        }

        const xero = parseAccountTransactionsSheet(
          workbook,
          file.name,
          // A bank account by name and by having no chart code. "Stripe Fees"
          // is an expense that matches the word, and counting it as a second
          // bank posting threw the whole entry away.
          (name, accountCode) => accountCode === "" && BANKISH.test(name),
          (name) => STRUCTURAL.has(name),
          sheetOptions,
        );
        if (xero.length > 0) {
          lines.push(...xero);
          continue;
        }
        const found = parseReconciledSheet(workbook, file.name);
        if (found.length === 0) {
          problems.push(
            `${file.name}: not an Account Transactions export and no reconciled sheet found. ` +
              "Export it from Xero as Reporting > Account Transactions with grouping set to None.",
          );
        }
        lines.push(...found);
        continue;
      }

      const text = one.text ?? "";
      if (/^\*?Code,/m.test(text) || text.startsWith("*Code")) {
        const parsed = parseChartOfAccounts(text);
        chart.push(...parsed.accounts);
        for (const problem of parsed.problems) problems.push(`${file.name}: ${problem.message}`);
        continue;
      }

      const report = parseXeroJournalReport(text);
      if (report.journals.length > 0) {
        lines.push(...referenceFromJournals(report.journals, isBankLine, isStructural, file.name));
        const unbalanced = report.problems.filter((p) => p.message.startsWith("does not balance"));
        if (unbalanced.length > 0) {
          problems.push(`${file.name}: ${unbalanced.length} journals do not balance and were still read.`);
        }
        continue;
      }

      // The working spreadsheet, pasted out as CSV rather than saved as a
      // workbook. Tried last because it is the loosest shape of the three: it
      // asks only for Date, Amount and a What column, which a journal report
      // and a chart would also satisfy in part.
      const reconciled = parseReconciledCsv(text, file.name);
      if (reconciled.length > 0) {
        lines.push(...reconciled);
        continue;
      }

      // An Account Transactions report as a CSV, which is what this app writes
      // when it exports one. Read through the very same reader the workbook
      // takes, so the two cannot come to mean different things, and so a
      // ledger exported here can be checked against here.
      const asSheet = csvToSheet(text, file.name);
      // Our own export puts one line of a bank statement in every row, so its
      // Account column is a bank account by construction and needs no guessing
      // at from the name. Only ours: an accounting system's report may list any
      // account at all, and reading somebody's expenses as bank lines would put
      // every figure out.
      const ours = text.includes(EXPORT_MARK);
      const asReport = parseAccountTransactionsSheet(
        { sheets: [asSheet], problems: [] },
        file.name,
        (name, accountCode) => accountCode === "" && (ours || BANKISH.test(name)),
        (name) => STRUCTURAL.has(name),
        sheetOptions,
      );
      if (asReport.length > 0) {
        lines.push(...asReport);
        continue;
      }

      // Not a shape this recognises -- but it is a table, and its headings can
      // be shown so the columns are chosen rather than guessed.
      const sheet = csvToSheet(text, file.name);
      const headings = sheetHeadings(sheet);
      if (headings.columns.length >= 3) {
        unreadable.push({ name: file.name, sheet, headings: headings.columns });
      } else {
        problems.push(
          `${file.name}: not a journal report, chart of accounts, or reconciled sheet, ` +
            "and not a table with headings either.",
        );
      }
    } catch (error) {
      problems.push(`${file.name}: ${(error as Error).message}`);
    }
  }

  return { lines, chart, problems, allocations, unreadable, journals, payouts };
}

export { compareCodings, inferAccountMapping };
