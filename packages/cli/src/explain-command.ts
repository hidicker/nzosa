import { explained, formatAmount, parseAmount } from "@nzosa/core";
import type { VarianceNote } from "@nzosa/core";
import { loadLedger, saveLedger } from "./ledger.js";

export interface ExplainOptions {
  ledger: string;
  /** GST period end this note concerns. */
  period: string | undefined;
  /** How much of the difference it explains, as a dollar string. */
  amount: string | undefined;
  note: string | undefined;
  list: boolean;
  /** Remove every note on the given period, for when one turns out wrong. */
  clear: boolean;
  json: boolean;
}

/**
 * Record why our figures and a filed return differ.
 *
 * Chasing a difference and deciding it is acceptable is real work, and without
 * somewhere to put the conclusion it gets done again every time. Writing it
 * down also changes what the comparison reports: the interesting number stops
 * being the raw difference and becomes the part nobody has explained yet.
 */
export function runExplain(options: ExplainOptions): number {
  const ledger = loadLedger(options.ledger);
  const notes = [...(ledger.varianceNotes ?? [])];

  if (options.clear && options.period !== undefined) {
    // An explanation can turn out to be wrong, and a wrong one is worse than
    // none: it hides a real difference behind a confident-looking reason.
    const kept = notes.filter((n) => n.period !== options.period);
    const removed = notes.length - kept.length;
    saveLedger(options.ledger, { ...ledger, varianceNotes: kept });
    process.stdout.write(`Removed ${removed} note(s) on ${options.period}.\n`);
    return 0;
  }

  if (options.list || options.period === undefined) {
    if (notes.length === 0) {
      process.stdout.write(
        'No accepted differences recorded. Use "explain --period <date> --amount <n> --note <why>".\n',
      );
      return 0;
    }
    if (options.json) {
      process.stdout.write(`${JSON.stringify(notes, null, 2)}\n`);
      return 0;
    }

    const periods = [...new Set(notes.map((n) => n.period))].sort();
    for (const period of periods) {
      process.stdout.write(`\n${period}   explains ${formatAmount(explained(notes, period))}\n`);
      for (const note of notes.filter((n) => n.period === period)) {
        process.stdout.write(`   ${formatAmount(note.amount).padStart(10)}  ${note.reason}\n`);
      }
    }
    process.stdout.write("\n");
    return 0;
  }

  if (options.amount === undefined || options.note === undefined) {
    process.stderr.write("explain needs --period, --amount and --note.\n");
    return 2;
  }

  const amount = parseAmount(options.amount);
  if (amount === null) {
    process.stderr.write(`--amount needs a figure, got ${JSON.stringify(options.amount)}.\n`);
    return 2;
  }

  const note: VarianceNote = {
    period: options.period,
    amount,
    reason: options.note,
    at: new Date().toISOString().slice(0, 10),
  };
  notes.push(note);
  saveLedger(options.ledger, { ...ledger, varianceNotes: notes });

  process.stdout.write(
    `Recorded: ${formatAmount(amount)} of the ${note.period} difference is explained.\n` +
      `  ${note.reason}\n` +
      `${formatAmount(explained(notes, note.period))} explained for that period in total.\n`,
  );
  return 0;
}
