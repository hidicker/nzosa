import { readFileSync } from "node:fs";
import {
  expandSplits,
  formatAmount,
  inRange,
  parseXeroAccountTransactions,
  reconcileAgainstXero,
} from "@nzosa/core";
import type { DateRange, Transaction, XeroDayDifference } from "@nzosa/core";
import { loadLedger } from "./ledger.js";
import { readExport } from "./spreadsheet.js";

export interface ReconcileOptions {
  ledger: string;
  /** Path to a Xero Account Transactions export. */
  xero: string | undefined;
  range: Partial<DateRange>;
  accounts: string[] | undefined;
  /** How far apart two dates may be and still be the same event. */
  window: number;
  /** Show days that agree in total as well as those that do not. */
  all: boolean;
  /**
   * Compare whole bank lines against grouped Xero events, rather than split
   * parts against individual rows.
   */
  whole: boolean;
  json: boolean;
}

function truncate(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

/**
 * Reconcile our reporting against Xero's.
 *
 * The whole premise is that bank data plus the user's own coding and invoices
 * is enough to produce the accounts. This is the check on that: same period,
 * both sides, every difference shown.
 */
export async function reconcileCommand(options: ReconcileOptions): Promise<number> {
  if (options.xero === undefined) {
    process.stderr.write('Give a Xero export with "--xero <file>".\n');
    return 2;
  }

  const ledger = loadLedger(options.ledger);
  const parsed = parseXeroAccountTransactions(await readExport(options.xero));

  for (const problem of parsed.problems) {
    process.stderr.write(`  line ${problem.line}: ${problem.message}\n`);
  }
  if (parsed.entries.length === 0) {
    process.stderr.write("No bank-account rows found in that export.\n");
    return 2;
  }

  const range = options.range;

  // One statement line is often several postings in Xero -- a payout with its
  // fee, freight with border GST -- and both sides represent that the same
  // way: we split the line, Xero writes several rows. So either both sides are
  // expanded or both are collapsed; mixing them reports differences that are
  // not real.
  //
  // Expanded is the default because it is the finer comparison, and because
  // only some Xero events carry a shared reference to collapse on: a Stripe
  // payout has its `ch_` charge id, freight and its border GST have nothing in
  // common but a date. Collapsing what can be collapsed while the rest stays
  // expanded is the worst of both. `--whole` compares at bank-line level, for
  // a ledger that has no splits recorded yet.
  const source = options.whole
    ? ledger.transactions
    : expandSplits(ledger.transactions, ledger.splits ?? {}).transactions;

  // An empty list means every account, the way it does everywhere else here.
  // Read as "no accounts" it silently emptied our side of the comparison, and
  // the command then reported the whole of Xero as a difference -- a report
  // that looks like a catastrophic disagreement and is really no comparison
  // at all.
  const only = options.accounts ?? [];
  const wanted = (t: Transaction): boolean =>
    inRange(t.date, range) && (only.length === 0 || only.includes(t.account));

  const ours = source.filter(wanted);
  const theirs = parsed.entries.filter((e) => inRange(e.date, range));

  const result = reconcileAgainstXero(ours, theirs, {
    windowDays: options.window,
    groupByReference: options.whole,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  const money = (n: number) => formatAmount(n);
  const disagree = result.days.filter((d) => d.difference !== 0);
  const agree = result.days.filter((d) => d.difference === 0);

  process.stdout.write("\nXero reconciliation\n");
  if (range.from || range.to) {
    process.stdout.write(`${range.from ?? "the beginning"} to ${range.to ?? "the end"}\n`);
  }
  process.stdout.write("\n");
  process.stdout.write(`  Ours                ${money(result.ourTotal).padStart(14)}  ${String(ours.length).padStart(5)} lines\n`);
  process.stdout.write(`  Xero                ${money(result.theirTotal).padStart(14)}  ${String(theirs.length).padStart(5)} lines\n`);
  process.stdout.write(`  Difference          ${money(result.difference).padStart(14)}\n\n`);
  process.stdout.write(
    `  ${result.matched.length} matched exactly, ` +
      `${disagree.length} day(s) differ, ` +
      `${agree.length} day(s) agree in total but not line by line.\n`,
  );

  if (result.difference === 0 && disagree.length === 0) {
    process.stdout.write("\nEvery line ties. Our reporting and Xero agree.\n\n");
    return 0;
  }

  const showDay = (day: XeroDayDifference): void => {
    process.stdout.write(`\n${day.date}`);
    if (day.difference !== 0) process.stdout.write(`   out by ${money(day.difference)}`);
    process.stdout.write("\n");

    for (const t of day.ours) {
      process.stdout.write(
        `    ours   ${money(t.amount).padStart(12)}  ${truncate(t.otherParty || t.reference || "--", 34).padEnd(36)}` +
          `${truncate(t.account, 24)}\n`,
      );
    }
    for (const e of day.theirs) {
      process.stdout.write(
        `    xero   ${money(e.amount).padStart(12)}  ${truncate(e.contact || e.description || "--", 34).padEnd(36)}` +
          `${truncate(e.source, 24)}\n`,
      );
    }
  };

  if (disagree.length > 0) {
    process.stdout.write("\n\nDays where the two sides do not agree\n");
    process.stdout.write("These are the real differences: money one side has and the other does not.\n");
    for (const day of disagree) showDay(day);
  }

  if (agree.length > 0) {
    process.stdout.write(
      `\n\n${agree.length} day(s) agree in total but are split differently.\n` +
        "Usually one bank line that Xero recorded as several postings -- a payout\n" +
        "with its fee, or freight with border GST. Nothing to fix.\n",
    );
    if (options.all) for (const day of agree) showDay(day);
    else process.stdout.write('Use "--all" to list them.\n');
  }

  process.stdout.write("\n");
  return 0;
}
