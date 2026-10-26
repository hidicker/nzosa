import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";

/**
 * Figures for reading a business at a glance: how long customers take to pay,
 * and where the bank balance is heading over the next three months.
 */

/**
 * Days sales outstanding: what customers owe, as days of sales. Owing 10,000
 * on sales of 120,000 over a 365-day year is about 30 days. Null with no
 * sales to measure against.
 */
export function daysSalesOutstanding(owing: Cents, sales: Cents, days: number): number | null {
  if (sales <= 0 || days <= 0) return null;
  return Math.round((Math.max(0, owing) / sales) * days);
}

/** An invoice or bill still owing, as the forecast reads it. */
export interface OwingDocument {
  kind: "sales" | "purchase";
  /** When it is expected to be paid: its due date, or a guess from its date. */
  expected: IsoDate;
  /** Still owing, positive. */
  remaining: Cents;
}

export interface ForecastBucket {
  from: IsoDate;
  to: IsoDate;
  /** From customers. */
  in: Cents;
  /** To suppliers, positive. */
  out: Cents;
  /** The balance at the end of the bucket. */
  closing: Cents;
}

function addDays(day: IsoDate, n: number): IsoDate {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Three months of cash, thirty days at a time: today's bank balance, plus what
 * customers owe and less what is owed to suppliers, each on the day it is
 * expected. Anything overdue is counted in the first thirty days. What is
 * expected after the ninety days is left out.
 */
export function cashForecast(opening: Cents, today: IsoDate, owing: readonly OwingDocument[], buckets = 3): ForecastBucket[] {
  const out: ForecastBucket[] = [];
  let balance = opening;
  for (let i = 0; i < buckets; i += 1) {
    const from = addDays(today, i * 30);
    const to = addDays(today, i * 30 + 29);
    let cashIn = 0;
    let cashOut = 0;
    for (const doc of owing) {
      if (doc.remaining <= 0) continue;
      const when = doc.expected < today ? today : doc.expected;
      if (when < from || when > to) continue;
      if (doc.kind === "sales") cashIn += doc.remaining;
      else cashOut += doc.remaining;
    }
    balance += cashIn - cashOut;
    out.push({ from, to, in: cashIn, out: cashOut, closing: balance });
  }
  return out;
}

/** The change from one figure to another as a share of the first, or null from nothing. */
export function changeShare(before: Cents, now: Cents): number | null {
  if (before === 0) return null;
  return (now - before) / Math.abs(before);
}
