import {
  categorise,
  gstContent,
  expandSplits,
  formatAmount,
  gstPeriods,
  gstResolver,
  gstReturn,
  validateSplits,
} from "@nzosa/core";
import type {
  DateRange,
  GstBasis,
  GstReturnResult,
  GstRounding,
  Transaction,
} from "@nzosa/core";

import { loadLedger } from "./ledger.js";
import { computeGstReturns } from "./gst-engine.js";

export interface GstOptions {
  ledger: string;
  range: Partial<DateRange>;
  months: 1 | 2 | 6;
  anchorMonth: number;
  basis: GstBasis;
  /** How the GST content is arrived at. */
  rounding: GstRounding;
  sharePercent: number;
  /** Restrict to these account ids. Empty means every account in the ledger. */
  accounts: string[];
  /** Path to a JSON rule set, for coding transactions before selecting them. */
  rulesPath: string | undefined;
  /** Restrict to transactions the rules coded to one of these. Needs rulesPath. */
  codes: string[];
  detail: boolean;
  /** `plain` for the summary table, `xero` to mirror Xero's GST return layout. */
  format: "plain" | "xero";
  json: boolean;
}

/**
 * Produce a GST101A return for each period in the range.
 *
 * The output is laid out by box number so it can be read straight across to a
 * filed return or into myIR.
 */
export function runGst(options: GstOptions): number {
  const ledger = loadLedger(options.ledger);

  if (options.range.from === undefined || options.range.to === undefined) {
    process.stderr.write("gst needs a period: use --year, or both --from and --to.\n");
    return 2;
  }

  const computed = computeGstReturns(options, ledger);
  if ("error" in computed) return computed.error;
  const { returns, selected } = computed;

  if (options.json) {
    process.stdout.write(`${JSON.stringify(returns, null, 2)}\n`);
    return 0;
  }

  if (options.format === "xero") {
    for (const result of returns) writeXeroReturn(result, options);
    return 0;
  }

  writeHeader(options, selected.length);
  writeTable(returns);
  if (options.detail) writeDetail(returns);
  writeConfirmation(returns, ledger.overrides ?? {});
  writeWarnings(returns, options);

  return 0;
}
/**
 * The return laid out the way Xero presents it.
 *
 * Same box order, same wording, and the same two parts: the return itself and
 * the transactions behind it grouped by tax rate. The point is that it can be
 * read side by side with a filed return without translating anything.
 */
function writeXeroReturn(result: GstReturnResult, options: GstOptions): void {
  const b = result.boxes;
  const money = (n: number) => formatAmount(n);
  const out = (text: string) => process.stdout.write(text);

  out(`\nGST return\n`);
  out(`For the period ${result.period.from} to ${result.period.to}\n`);
  out(`${b.outcome === "refund" ? "GST refund" : "GST to pay"}   ${money(b.box15)}\n\n`);

  out(`Return details\n`);
  out(`Tax basis                ${options.basis === "payments" ? "Payments" : "Invoice"} basis\n\n`);

  const row = (box: string, label: string, value: number) =>
    out(`${box.padEnd(8)}${label.padEnd(52)}${money(value).padStart(14)}\n`);

  out("Sales and Income\n");
  row("Box 5", "Total sales and income", b.box5);
  row("Box 6", "Zero-rated supplies", b.box6);
  row("Box 7", "Net GST sales and income", b.box7);
  row("Box 8", "Total GST collected on sales and income", b.box8);
  row("Box 9", "Any debit adjustments", b.box9);
  row("Box 10", "Total GST collected for the period", b.box10);

  out("\nPurchases and Expenses\n");
  row("Box 11", "Total purchases and expenses", b.box11);
  row("Box 12", "Total GST credits on purchases and expenses", b.box12);
  row("Box 13", "Any credit adjustments", b.box13);
  row("Box 14", "Total GST credit", b.box14);
  row("Box 15", b.outcome === "refund" ? "GST refund" : "GST to pay", b.box15);

  // Grouped by tax rate, the way Xero groups them, so the two can be read
  // side by side without translating between layouts.
  const groups = new Map<string, GstReturnResult["lines"]>();
  const rateOf = (line: GstReturnResult["lines"][number]): string => {
    if (line.classification.side === "imports") return "GST on Imports";
    if (line.classification.treatment === "zero-rated") return "Zero Rated";
    if (line.classification.treatment !== "standard") return "No GST";
    return line.classification.side === "sales" ? "15% GST on Income" : "15% GST on Expenses";
  };

  for (const line of result.lines) {
    const key = rateOf(line);
    const list = groups.get(key);
    if (list) list.push(line);
    else groups.set(key, [line]);
  }

  out("\n\nTransactions\n");
  for (const [rate, lines] of groups) {
    out(`\n${rate}\n`);
    out(
      `${"Date".padEnd(12)}${"Contact".padEnd(28)}${"Description".padEnd(26)}` +
        `${"Gross".padStart(12)}${"Net".padStart(12)}${"GST".padStart(11)}\n`,
    );

    let gross = 0;
    let gst = 0;
    const ordered = [...lines].sort((a, z) => a.transaction.date.localeCompare(z.transaction.date));

    for (const line of ordered) {
      const t = line.transaction;
      // Xero shows expenses as positive amounts under an expense heading, so
      // the sign is carried by the group rather than repeated on every row.
      const amount = line.classification.side === "purchases" ? -line.amount : line.amount;
      const tax = rate.startsWith("15%") ? gstContent(amount) : 0;
      gross += amount;
      gst += tax;
      out(
        `${t.date.padEnd(12)}${truncate(t.otherParty || "--", 26).padEnd(28)}` +
          `${truncate(t.particulars || t.reference || "", 24).padEnd(26)}` +
          `${money(amount).padStart(12)}${money(amount - tax).padStart(12)}${money(tax).padStart(11)}\n`,
      );
    }

    out(
      `${"Total".padEnd(66)}${money(gross).padStart(12)}` +
        `${money(gross - gst).padStart(12)}${money(gst).padStart(11)}\n`,
    );
  }
  out("\n");
}

function writeHeader(options: GstOptions, count: number): void {
  const cycle =
    options.months === 1 ? "monthly" : options.months === 2 ? "two-monthly" : "six-monthly";

  process.stdout.write(`GST101A returns\n`);
  process.stdout.write(`  period    ${options.range.from} to ${options.range.to}\n`);
  process.stdout.write(`  cycle     ${cycle}, periods ending month ${options.anchorMonth}\n`);
  process.stdout.write(`  basis     ${options.basis}\n`);
  if (options.sharePercent !== 100) {
    process.stdout.write(`  share     ${options.sharePercent}%\n`);
  }
  process.stdout.write(
    `  accounts  ${options.accounts.length === 0 ? "all in ledger" : options.accounts.join(", ")}\n`,
  );
  if (options.codes.length > 0) {
    process.stdout.write(`  codes     ${options.codes.join(", ")}\n`);
  }
  process.stdout.write(`  selected  ${count} transactions\n\n`);
}

function writeTable(returns: readonly GstReturnResult[]): void {
  const columns = [
    ["PERIOD END", 10],
    ["DUE", 10],
    ["BOX 5 SALES", 14],
    ["BOX 6 ZERO", 12],
    ["BOX 8 GST", 12],
    ["BOX 11 BUYS", 14],
    ["BOX 12 GST", 12],
    ["BOX 15", 12],
    ["", 8],
  ] as const;

  process.stdout.write(
    columns
      .map(([label, width]) => (label === "" ? label.padEnd(width) : label.padStart(width)))
      .join("  ") + "\n",
  );

  const totals = { box5: 0, box6: 0, box8: 0, box11: 0, box12: 0, box15: 0 };

  for (const result of returns) {
    const b = result.boxes;
    totals.box5 += b.box5;
    totals.box6 += b.box6;
    totals.box8 += b.box8;
    totals.box11 += b.box11;
    totals.box12 += b.box12;
    totals.box15 += b.outcome === "pay" ? b.box15 : -b.box15;

    process.stdout.write(
      [
        result.period.to.padStart(10),
        result.period.due.padStart(10),
        formatAmount(b.box5).padStart(14),
        formatAmount(b.box6).padStart(12),
        formatAmount(b.box8).padStart(12),
        formatAmount(b.box11).padStart(14),
        formatAmount(b.box12).padStart(12),
        formatAmount(b.box15).padStart(12),
        `  ${b.outcome}`.padEnd(8),
      ].join("  ") + "\n",
    );
  }

  process.stdout.write(
    [
      "TOTAL".padStart(10),
      "".padStart(10),
      formatAmount(totals.box5).padStart(14),
      formatAmount(totals.box6).padStart(12),
      formatAmount(totals.box8).padStart(12),
      formatAmount(totals.box11).padStart(14),
      formatAmount(totals.box12).padStart(12),
      formatAmount(Math.abs(totals.box15)).padStart(12),
      `  ${totals.box15 >= 0 ? "pay" : "refund"}`.padEnd(8),
    ].join("  ") + "\n",
  );
}

function writeDetail(returns: readonly GstReturnResult[]): void {
  for (const result of returns) {
    process.stdout.write(`\n\nPeriod ending ${result.period.to}\n`);

    const sales = result.lines.filter((line) => line.classification.side === "sales");
    const purchases = result.lines.filter((line) => line.classification.side === "purchases");

    writeLines("Box 5 -- sales and income", sales);
    writeLines("Box 11 -- purchases and expenses", purchases);
    writeLines("Excluded from the return", result.excluded);
  }
}

function writeLines(title: string, lines: readonly GstReturnResult["lines"][number][]): void {
  if (lines.length === 0) return;

  process.stdout.write(`\n  ${title} (${lines.length})\n`);
  for (const line of lines) {
    const t = line.transaction;
    process.stdout.write(
      `    ${t.date}  ${formatAmount(line.amount, t.currency).padStart(12)}  ` +
        `${truncate(t.otherParty || t.particulars || "--", 30).padEnd(30)}  ` +
        `${line.classification.treatment.padEnd(13)}${line.classification.reason ?? ""}\n`,
    );
  }
}

/**
 * Point at the parts of the result that most need a human.
 *
 * Everything unmatched has been assumed standard-rated, which is the
 * assumption most likely to be wrong, so its size is reported rather than left
 * for the reader to discover after filing.
 */
function writeConfirmation(
  returns: readonly GstReturnResult[],
  overrides: Record<string, { confirmed?: boolean }>,
): void {
  let confirmedValue = 0;
  let unconfirmedValue = 0;
  let confirmedCount = 0;
  let unconfirmedCount = 0;

  for (const result of returns) {
    for (const line of result.lines) {
      // A split part inherits its parent's decision.
      const id = line.transaction.extras.splitOf ?? line.transaction.id;
      const ok = overrides[id]?.confirmed === true || overrides[line.transaction.id]?.confirmed === true;
      if (ok) {
        confirmedCount += 1;
        confirmedValue += Math.abs(line.amount);
      } else {
        unconfirmedCount += 1;
        unconfirmedValue += Math.abs(line.amount);
      }
    }
  }

  const total = confirmedValue + unconfirmedValue;
  if (total === 0) return;

  const pct = (unconfirmedValue / total) * 100;
  process.stdout.write("\nReview status\n");
  process.stdout.write(
    `  confirmed by a human   ${String(confirmedCount).padStart(5)} lines  ` +
      `${formatAmount(confirmedValue).padStart(13)}\n`,
  );
  process.stdout.write(
    `  still only suggested   ${String(unconfirmedCount).padStart(5)} lines  ` +
      `${formatAmount(unconfirmedValue).padStart(13)}   ${pct.toFixed(0)}% of the return\n`,
  );
  if (unconfirmedCount > 0) {
    process.stdout.write(
      '  Rules suggest; they do not decide. Confirm with ' +
        '"nzosa override <id> --confirm".\n',
    );
  }
}

function writeWarnings(returns: readonly GstReturnResult[], options: GstOptions): void {
  const unmatched = returns
    .flatMap((result) => result.lines)
    .filter((line) => (line.classification.reason ?? "").startsWith("No rule matched"));

  const value = unmatched.reduce((n, line) => n + Math.abs(line.amount), 0);

  process.stdout.write("\n");
  if (unmatched.length > 0) {
    process.stdout.write(
      `${unmatched.length} transaction(s) totalling ${formatAmount(value)} matched no rule and ` +
        `were assumed standard-rated.\nRun again with --detail to see them. Overseas purchases ` +
        `and unregistered suppliers are the usual corrections.\n`,
    );
  }

  if (options.basis !== "payments") {
    const missing = returns.reduce((n, result) => n + result.missingTaxPoint.length, 0);
    const placed = returns.reduce(
      (n, result) =>
        n + result.lines.length + result.excluded.length - result.missingTaxPoint.length,
      0,
    );

    if (missing === 0 && placed > 0) {
      process.stdout.write(
        `\nEvery transaction carried a tax point, so this is a true ${options.basis}-basis return.\n`,
      );
    } else {
      process.stdout.write(
        `\n${missing} transaction(s) have no tax point recorded and were placed by the date\n` +
          "they were paid, which is the payments-basis answer. Until each carries the date\n" +
          `its invoice was raised, this is not yet a true ${options.basis}-basis return.\n`,
      );
    }
  }
}

function truncate(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, width - 1)}…`;
}
