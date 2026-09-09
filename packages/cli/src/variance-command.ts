import { readFileSync } from "node:fs";
import { explained, formatAmount, parseFiledReturn, readXlsx, validateFiledReturn } from "@nzosa/core";
import type { FiledLine, FiledReturn, GstReturnResult } from "@nzosa/core";
import type { GstOptions } from "./gst-command.js";
import { computeGstReturns } from "./gst-engine.js";
import { loadLedger, saveLedger } from "./ledger.js";

export interface VarianceOptions extends GstOptions {
  /** GST return workbooks to load. */
  importPaths: string[];
  /** Drill into one period's lines rather than listing every period. */
  period: string | undefined;
}

/**
 * Compare what we produce against what was filed.
 *
 * Two figures are compared, and it matters which: Box 8 less Box 12, the
 * period's own trading. Box 15 also carries the adjustments in Boxes 9 and 13 --
 * late claims, year-end corrections -- which come from events a bank-derived
 * ledger has no way to contain. Comparing against Box 15 would report those as
 * our errors.
 *
 * The number worth watching is the last column: the part of a difference that
 * nobody has looked at yet. A difference someone has examined and accepted is
 * recorded with `explain`, and drops out of it.
 */
export async function runVariance(options: VarianceOptions): Promise<number> {
  const ledger = loadLedger(options.ledger);

  if (options.importPaths.length > 0) {
    const filed = [...(ledger.filedReturns ?? [])];
    for (const path of options.importPaths) {
      const workbook = await readXlsx(new Uint8Array(readFileSync(path)));
      const parsed = parseFiledReturn(workbook);
      for (const problem of parsed.problems) {
        process.stderr.write(`  ${path}: ${problem.message}\n`);
      }
      for (const one of parsed.returns) {
        // The form's own arithmetic has to hold. When it does not, the sheet
        // has been misread, and storing it would put a wrong baseline beyond
        // anyone's notice -- which is the failure this whole command exists to
        // prevent.
        const issues = validateFiledReturn(one);
        if (issues.length > 0) {
          for (const issue of issues) process.stderr.write(`  ${issue.message}\n`);
          continue;
        }
        const at = filed.findIndex((f) => f.periodEnd === one.periodEnd);
        if (at >= 0) filed[at] = one;
        else filed.push(one);
      }
    }
    filed.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    saveLedger(options.ledger, { ...ledger, filedReturns: filed });
    ledger.filedReturns = filed;
    process.stdout.write(`Stored ${filed.length} filed returns.\n\n`);
  }

  const filed = ledger.filedReturns ?? [];
  if (filed.length === 0) {
    process.stdout.write('No filed returns. Use "--import <file.xlsx>" to load them.\n');
    return 0;
  }

  const computed = computeGstReturns(options, ledger);
  if ("error" in computed) return computed.error;
  const ours = new Map(computed.returns.map((r) => [r.period.to, r]));
  const notes = ledger.varianceNotes ?? [];

  if (options.period !== undefined) {
    const one = filed.find((f) => f.periodEnd === options.period);
    const mine = ours.get(options.period);
    if (!one || !mine) {
      process.stderr.write(`No filed return and computed return both covering ${options.period}.\n`);
      return 2;
    }
    writeDetail(one, mine);
    return 0;
  }

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        filed.map((f) => {
          const mine = ours.get(f.periodEnd);
          const core = mine ? mine.boxes.box8 - mine.boxes.box12 : null;
          return {
            period: f.periodEnd,
            filed: f.core,
            filedBox15: f.boxes.box15,
            ours: core,
            difference: core === null ? null : core - f.core,
            explained: explained(notes, f.periodEnd),
          };
        }),
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  process.stdout.write("\nGST returns: ours against what was filed\n");
  process.stdout.write("Box 8 less Box 12, so adjustments in Boxes 9 and 13 do not distort it.\n\n");
  process.stdout.write(
    `${"PERIOD".padEnd(12)}${"filed".padStart(11)}${"ours".padStart(11)}` +
      `${"diff".padStart(9)}${"explained".padStart(11)}${"left".padStart(9)}\n`,
  );

  let outstanding = 0;
  for (const one of filed) {
    const mine = ours.get(one.periodEnd);
    if (!mine) {
      process.stdout.write(`${one.periodEnd.padEnd(12)}${formatAmount(one.core).padStart(11)}${"--".padStart(11)}\n`);
      continue;
    }
    const core = mine.boxes.box8 - mine.boxes.box12;
    const difference = core - one.core;
    const accounted = explained(notes, one.periodEnd);
    const left = difference - accounted;
    outstanding += left;
    process.stdout.write(
      `${one.periodEnd.padEnd(12)}${formatAmount(one.core).padStart(11)}${formatAmount(core).padStart(11)}` +
        `${formatAmount(difference).padStart(9)}${formatAmount(accounted).padStart(11)}` +
        `${formatAmount(left).padStart(9)}${left === 0 ? "   settled" : ""}\n`,
    );
  }

  process.stdout.write(`\n${formatAmount(outstanding)} unexplained across ${filed.length} returns.\n`);
  process.stdout.write('Use "--period <date>" to see the lines behind one of them.\n\n');
  return 0;
}

/** Line-level comparison for one period. */
function writeDetail(one: FiledReturn, mine: GstReturnResult): void {
  // Import GST is already a tax figure bound for Box 13, not a rated line;
  // including it here would compare it against a gross amount.
  const oursLines = mine.lines
    .filter((line) => line.classification.side !== "imports")
    .map((line) => {
      const percent = line.classification.deductiblePercent ?? 100;
      return {
        date: line.transaction.date,
        amount: percent === 100 ? line.amount : Math.round((line.amount * percent) / 100),
        who: line.transaction.otherParty,
        what: line.transaction.particulars || line.transaction.reference || "",
      };
    });

  const theirLines = one.lines
    // Late claims belong to Box 9 or Box 13, not to the period's own trading,
    // so they are no part of a Box 8 less Box 12 comparison.
    .filter((line) => !line.lateClaim && (/^15%/.test(line.taxRate) || /^15%/.test(line.section)))
    .map((line) => ({
      date: line.date,
      amount: line.gross,
      who: line.contact,
      what: line.description,
    }));

  // Matched on amount and nearest date. Amount alone is not enough once a
  // period holds several payments of the same figure: they pair arbitrarily,
  // and lines that agree get reported as differences.
  const available = [...theirLines];
  const onlyOurs: typeof oursLines = [];
  let matched = 0;

  for (const line of [...oursLines].sort((a, b) => a.date.localeCompare(b.date))) {
    let best = -1;
    let bestGap = Number.POSITIVE_INFINITY;
    for (let i = 0; i < available.length; i += 1) {
      const candidate = available[i];
      if (!candidate || candidate.amount !== line.amount) continue;
      const gap = Math.abs(Date.parse(candidate.date) - Date.parse(line.date)) / 86_400_000;
      if (gap < bestGap) {
        best = i;
        bestGap = gap;
      }
    }
    if (best >= 0 && bestGap <= 21) {
      available.splice(best, 1);
      matched += 1;
    } else {
      onlyOurs.push(line);
    }
  }

  const gstOf = (lines: readonly { amount: number }[]): number =>
    lines.reduce((sum, line) => sum + Math.round((line.amount * 3) / 23), 0);

  process.stdout.write(`\n${one.periodEnd}   ${one.basis}\n`);
  process.stdout.write(
    `  filed ${String(theirLines.length).padStart(4)} rated lines, GST ${formatAmount(gstOf(theirLines)).padStart(10)}\n`,
  );
  process.stdout.write(
    `  ours  ${String(oursLines.length).padStart(4)} rated lines, GST ${formatAmount(gstOf(oursLines)).padStart(10)}\n`,
  );
  process.stdout.write(`  ${matched} agree exactly\n`);

  const show = (title: string, lines: readonly { date: string; amount: number; who: string; what: string }[]) => {
    if (lines.length === 0) return;
    process.stdout.write(`\n${title} (${lines.length}):\n`);
    for (const line of [...lines].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))) {
      process.stdout.write(
        `   ${line.date.padEnd(12)}${formatAmount(line.amount).padStart(11)}  ` +
          `GST ${formatAmount(Math.round((line.amount * 3) / 23)).padStart(8)}  ` +
          `${line.who.slice(0, 22).padEnd(23)}${line.what.slice(0, 34)}\n`,
      );
    }
  };

  show("In the filed return, not in ours", available);
  show("In ours, not in the filed return", onlyOurs);
  process.stdout.write(`\ndifference in GST: ${formatAmount(gstOf(oursLines) - gstOf(theirLines))}\n\n`);
}
