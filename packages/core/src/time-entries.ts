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
  /** Who did the work, where the books keep more than one person's time. */
  worker?: string;
  /**
   * Where the books ask for time to be approved before it is invoiced: sent
   * in, approved, or sent back. No value is time kept before approval was
   * asked for, which counts as approved, so turning approval on changes
   * nothing already there.
   */
  approval?: "submitted" | "approved" | "rejected";
  /** Who approved or sent it back. */
  approvedBy?: string;
  /** Why it was sent back. */
  rejectedBecause?: string;
}

/** Whether an entry may go on an invoice: approved, or kept before approval was asked for. */
export function timeApproved(entry: Pick<TimeEntry, "approval">): boolean {
  return entry.approval === undefined || entry.approval === "approved";
}

/** Entries waiting to be approved, oldest first. */
export function timeAwaitingApproval(entries: readonly TimeEntry[]): TimeEntry[] {
  return entries.filter((e) => e.approval === "submitted").sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * An entry approved or sent back. Only one waiting can be decided, and one
 * already on an invoice never is: approval is about what may be billed.
 */
export function decideTime(
  entry: TimeEntry,
  decision: "approved" | "rejected",
  by: string,
  because = "",
): TimeEntry {
  if (entry.approval !== "submitted" || entry.invoice !== undefined) return entry;
  const { rejectedBecause: _old, ...rest } = entry;
  return {
    ...rest,
    approval: decision,
    ...(by.trim() !== "" ? { approvedBy: by.trim() } : {}),
    ...(decision === "rejected" && because.trim() !== "" ? { rejectedBecause: because.trim() } : {}),
  };
}

/** What an entry comes to, to the cent. */
export function timeValue(entry: Pick<TimeEntry, "hours" | "rate">): Cents {
  return Math.round(entry.hours * entry.rate);
}

/** Billable entries not invoiced yet, by customer, in date order. */
export function unbilledTime(entries: readonly TimeEntry[]): Map<string, TimeEntry[]> {
  const out = new Map<string, TimeEntry[]>();
  for (const entry of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
    if (entry.nonBillable === true || entry.invoice !== undefined || !timeApproved(entry)) continue;
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
