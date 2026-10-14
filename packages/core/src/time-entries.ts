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
  /** The invoice it went on, once it has. */
  invoice?: string;
}

/** What an entry comes to, to the cent. */
export function timeValue(entry: Pick<TimeEntry, "hours" | "rate">): Cents {
  return Math.round(entry.hours * entry.rate);
}

/** Billable entries not invoiced yet, by customer, in date order. */
export function unbilledTime(entries: readonly TimeEntry[]): Map<string, TimeEntry[]> {
  const out = new Map<string, TimeEntry[]>();
  for (const entry of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
    if (entry.nonBillable === true || entry.invoice !== undefined) continue;
    out.set(entry.customer, [...(out.get(entry.customer) ?? []), entry]);
  }
  return out;
}

/** One invoice line an entry, saying the date, the hours and the rate. */
export function timeInvoiceLines(entries: readonly TimeEntry[], accountCode: string, money: (cents: Cents) => string): InvoiceLine[] {
  return entries.map((entry) => {
    const value = timeValue(entry);
    const hours = Number.isInteger(entry.hours) ? String(entry.hours) : entry.hours.toFixed(2);
    return {
      description: `${entry.date} ${entry.description} (${hours} h at ${money(entry.rate)})`.trim(),
      accountCode,
      taxType: "No GST",
      net: value,
      tax: 0,
      gross: value,
      quantity: entry.hours,
    };
  });
}
