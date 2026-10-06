import {
  accountMovement,
  adjustmentJournals,
  classifyJournal,
  formatAmount,
  inRange,
  parseXeroJournalReport,
} from "@nzosa/core";
import type { DateRange, Journal, JournalLine } from "@nzosa/core";
import { loadLedger, saveLedger } from "./ledger.js";
import { readExport } from "./spreadsheet.js";

export interface JournalOptions {
  ledger: string;
  /** Path to a Xero Journal Report export. */
  importPath: string | undefined;
  range: Partial<DateRange>;
  /** Only journals touching this account code, e.g. `820`. */
  code: string | undefined;
  json: boolean;
}

/** Receivable and payable control accounts: the mark of an invoice accrual. */
const CONTROL_CODES = new Set(["610", "800"]);

function isControlLine(line: JournalLine): boolean {
  return CONTROL_CODES.has(line.accountCode);
}

/** A journal line sitting on a bank account rather than a ledger account. */
function isBankLine(line: JournalLine): boolean {
  // Xero leaves the code blank on the bank side of a journal and names the
  // account instead, so the code is the reliable signal, not the name.
  return (
    line.accountCode === "" &&
    /\b(bank|bnz|anz|asb|westpac|kiwibank|visa|card|paypal|wise|stripe)\b/i.test(line.accountName)
  );
}

/**
 * Read the general ledger, and report what it holds that we cannot.
 *
 * The value here is entirely in the gap: journals with no bank line are events
 * our bank-derived ledger has no way to know about, and they are what makes a
 * filed Box 15 differ from the Box 8 less Box 12 we compute.
 */
export async function runJournals(options: JournalOptions): Promise<number> {
  const ledger = loadLedger(options.ledger);

  if (options.importPath !== undefined) {
    const text = await readExport(options.importPath);
    const parsed = parseXeroJournalReport(text);

    if (parsed.journals.length === 0) {
      for (const problem of parsed.problems) {
        process.stderr.write(`  ${problem.id || "(file)"}: ${problem.message}\n`);
      }
      return 2;
    }

    // A journal that does not balance has been read wrongly. Report it rather
    // than quietly deriving figures from a misaligned row.
    const unbalanced = parsed.problems.filter((p) => p.message.startsWith("does not balance"));
    for (const problem of unbalanced.slice(0, 10)) {
      process.stderr.write(`  journal ${problem.id}: ${problem.message}\n`);
    }

    saveLedger(options.ledger, { ...ledger, journals: parsed.journals });
    ledger.journals = parsed.journals;

    const lines = parsed.journals.reduce((n, j) => n + j.lines.length, 0);
    process.stdout.write(
      `Read ${parsed.journals.length} journals, ${lines} lines` +
        `${unbalanced.length > 0 ? `, ${unbalanced.length} do not balance` : ", all balancing"}.\n`,
    );
  }

  const journals = (ledger.journals ?? []).filter((j) => inRange(j.date, options.range));
  if (journals.length === 0) {
    process.stdout.write('No journals. Use "--import <file>" to load a Xero Journal Report.\n');
    return 0;
  }

  const selected = options.code
    ? journals.filter((j) => j.lines.some((l) => l.accountCode === options.code))
    : journals;

  const offLedger = adjustmentJournals(selected, isBankLine, isControlLine);
  const counts = { banked: 0, accrual: 0, adjustment: 0 };
  for (const journal of selected) counts[classifyJournal(journal, isBankLine, isControlLine)] += 1;

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ journals: selected, offLedger }, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(`\n${selected.length} journals`);
  if (options.code) process.stdout.write(` touching account ${options.code}`);
  process.stdout.write(
    `:\n  ${counts.banked} have a bank line, so we already hold the money\n` +
      `  ${counts.accrual} are invoice or bill accruals, correctly absent from a payments-basis return\n` +
      `  ${counts.adjustment} are adjustments -- what a bank-derived ledger cannot see\n\n`,
  );

  const width = 52;
  const grouped = new Map<string, { count: number; movement: number; date: string }>();
  for (const journal of offLedger) {
    const key = journal.narration || "(no narration)";
    const movement = options.code
      ? accountMovement([journal], (l) => l.accountCode === options.code)
      : journal.lines.reduce((sum, l) => sum + Math.max(l.amount, 0), 0);
    const seen = grouped.get(key);
    if (seen) {
      seen.count += 1;
      seen.movement += movement;
    } else {
      grouped.set(key, { count: 1, movement, date: journal.date });
    }
  }

  const ordered = [...grouped.entries()].sort((a, b) => Math.abs(b[1].movement) - Math.abs(a[1].movement));
  process.stdout.write(
    `${"first seen".padEnd(12)}${"n".padStart(4)}  ${"movement".padStart(12)}  narration\n`,
  );
  for (const [narration, info] of ordered.slice(0, 30)) {
    process.stdout.write(
      `${info.date.padEnd(12)}${String(info.count).padStart(4)}  ` +
        `${formatAmount(info.movement).padStart(12)}  ` +
        `${narration.length > width ? `${narration.slice(0, width - 1)}…` : narration}\n`,
    );
  }
  if (ordered.length > 30) {
    process.stdout.write(`... and ${ordered.length - 30} more\n`);
  }
  process.stdout.write("\n");
  return 0;
}


