import type { Cents } from "./money.js";
import type { InvoiceLine } from "./invoices.js";

/**
 * Time worked for customers, kept until it is invoiced. Nothing is posted from
 * an entry: an invoice made from it is, once it is approved.
 */
export interface TimeEntry {
  id: string;
  date: string;
  customer: string;
  /** Hours, to two places: 1.25 is an hour and a quarter. */
  hours: number;
  /** Per hour, in cents. */
  rate: Cents;
  description: string;
  /** Not billable: kept for the record only. */
  nonBillable?: boolean;
  /** The class (a job, a department) it is for, which its invoice is given. */
  className?: string;
  /** The invoice it went on, once it has. */
  invoice?: string;
  /** Who said it can be billed, and when, where time is approved before it is invoiced. */
  approved?: { by: string; at: string };
}

/** What an entry comes to, to the cent. */
export function timeValue(entry: Pick<TimeEntry, "hours" | "rate">): Cents {
  return Math.round(entry.hours * entry.rate);
}

/**
 * Billable entries not invoiced yet, by customer, in date order. Where time is
 * approved before it is billed, only the approved.
 */
export function unbilledTime(entries: readonly TimeEntry[], options: { approvedOnly?: boolean } = {}): Map<string, TimeEntry[]> {
  const out = new Map<string, TimeEntry[]>();
  for (const entry of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
    if (entry.nonBillable === true || entry.invoice !== undefined) continue;
    if (options.approvedOnly === true && entry.approved === undefined) continue;
    out.set(entry.customer, [...(out.get(entry.customer) ?? []), entry]);
  }
  return out;
}

/**
 * One invoice line an entry, saying the date, the hours and the rate. A rate
 * is before any sales tax, as hourly rates are quoted: `tax` adds it on.
 */
export function timeInvoiceLines(
  entries: readonly TimeEntry[],
  accountCode: string,
  money: (cents: Cents) => string,
  tax: { taxType: string; rate: number } = { taxType: "No GST", rate: 0 },
): InvoiceLine[] {
  return entries.map((entry) => {
    const value = timeValue(entry);
    const gst = Math.round(value * tax.rate);
    const hours = Number.isInteger(entry.hours) ? String(entry.hours) : entry.hours.toFixed(2);
    return {
      description: `${entry.date} ${entry.description} (${hours} h at ${money(entry.rate)})`.trim(),
      accountCode,
      taxType: tax.taxType,
      net: value,
      tax: gst,
      gross: value + gst,
      quantity: entry.hours,
    };
  });
}
