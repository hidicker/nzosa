import type { IsoDate } from "./dates.js";
import { filedReturnFromBoxes, gstBoxesFrom } from "./filed-return-entry.js";
import type { FiledReturn, FiledReturnProblem } from "./filed-returns.js";
import { readIrdExport } from "./ird-records.js";
import type { IrdGstPeriod } from "./ird-records.js";

/**
 * myIR's GST return summary, as filed returns to reconcile against.
 *
 * One download holding every return on a GST account, a row each, with every
 * box the reconciliation compares. Reading the file is `readIrdExport`'s, the
 * one reader of myIR's exports, which Inland Revenue records uses too; this
 * only turns its periods into filed returns -- so the two cannot come to read
 * the same file differently.
 *
 * What the summary does not carry is each period's first day. It is worked
 * out: a period starts the day after the one before it ends, and the first,
 * with no row before it, takes the spacing of the rows after it -- two-monthly,
 * here, as almost everyone's is.
 */

export interface GstSummaryResult {
  returns: FiledReturn[];
  problems: FiledReturnProblem[];
  /** The GST account the file is for, e.g. `123-456-789-GST002`. */
  account: string;
  /** Whose it is, as myIR names them. */
  name: string;
}

/** Whether a file is myIR's GST return summary. */
export function isGstReturnSummary(text: string): boolean {
  return readIrdExport(text).record?.kind === "gst-returns";
}

function dayAfterIso(day: IsoDate): IsoDate {
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10) as IsoDate;
}

/** Months from one period end to the next, by calendar month. */
function monthsApart(from: IsoDate, to: IsoDate): number {
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
}

/** The first day of the period `months` long that ends on `end`. */
function startOf(end: IsoDate, months: number): IsoDate {
  const first = new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - months, 1));
  return first.toISOString().slice(0, 10) as IsoDate;
}

/** The filed returns in a GST return summary, each period checked as it is read. */
export function gstSummaryReturns(
  periods: readonly IrdGstPeriod[],
  options: { basis?: string; account?: string } = {},
): { returns: FiledReturn[]; problems: FiledReturnProblem[] } {
  const problems: FiledReturnProblem[] = [];
  const rows = [...periods].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));

  // The usual length of a period, from the gaps between them, for the first.
  const gaps = rows.slice(1).map((row, i) => monthsApart(rows[i]?.periodEnd ?? row.periodEnd, row.periodEnd));
  const usual = gaps.length === 0 ? null : gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? null;
  const account = options.account ?? "";

  const returns: FiledReturn[] = [];
  rows.forEach((row, index) => {
    const before = rows[index - 1];
    const periodStart =
      before !== undefined
        ? dayAfterIso(before.periodEnd)
        : usual !== null && usual > 0
          ? startOf(row.periodEnd, usual)
          : null;

    // Boxes 8 and 12 are what the period itself collected and paid: the
    // totals, less the adjustments, exactly as the form adds them up.
    const boxes = gstBoxesFrom({
      box5: row.totalSales,
      box6: row.zeroRated,
      box9: row.debitAdjustments,
      box11: row.totalExpenses,
      box13: row.creditAdjustments,
      box8: row.gstCollected - row.debitAdjustments,
      box12: row.gstPaid - row.creditAdjustments,
    });
    if (Math.abs(boxes.box15) !== Math.abs(row.paymentOrRefund)) {
      problems.push({
        message: `${row.periodEnd}: GST collected less GST paid is not the payment or refund it shows, so this period was left out.`,
      });
      return;
    }
    returns.push({
      ...filedReturnFromBoxes({
        periodStart,
        periodEnd: row.periodEnd,
        basis: options.basis ?? "Basis not stated",
        status: `Filed (myIR return summary${account === "" ? "" : `, ${account}`})`,
        boxes,
      }),
      ...(account !== "" ? { registration: account } : {}),
    });
  });
  return { returns, problems };
}

export function parseGstReturnSummary(text: string, options: { basis?: string } = {}): GstSummaryResult {
  const { record, problem } = readIrdExport(text);
  if (record === null || record.kind !== "gst-returns") {
    return {
      returns: [],
      problems: [{ message: problem ?? "Not a GST return summary." }],
      account: record !== null && "accountId" in record ? record.accountId : "",
      name: record?.name ?? "",
    };
  }
  const { returns, problems } = gstSummaryReturns(record.periods, { ...options, account: record.accountId });
  return { returns, problems, account: record.accountId, name: record.name };
}
