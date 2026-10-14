import type { IsoDate } from "./dates.js";
import { daysInMonth } from "./dates.js";
import type { Invoice, InvoiceLine } from "./invoices.js";
import { nextInvoiceNumber } from "./invoice-candidates.js";

/**
 * Invoices that repeat.
 *
 * A schedule is an invoice written once -- who it is to, what for, how often.
 * Nothing runs by itself: a person presses "create due invoices" and each
 * schedule that has come due makes its invoice or invoices, as drafts. A
 * draft is not in the books until it is sent, so a schedule can never put a
 * sale into a return that nobody looked at.
 *
 * Dates are worked out from the first date and a count, never by adding to
 * the last one. Adding a month to 31 January gives 28 February, and adding
 * another gives 28 March -- the schedule drifts off the 31st for ever.
 * Counting from the anchor lands on the 31st or the last day of the month,
 * each time.
 */

export type RecurringFrequency = "weekly" | "fortnightly" | "monthly" | "quarterly" | "yearly";

export const RECURRING_FREQUENCIES: readonly RecurringFrequency[] = [
  "weekly",
  "fortnightly",
  "monthly",
  "quarterly",
  "yearly",
];

/** The most one schedule may make in one go, so a typo in a date cannot flood the books. */
export const MAX_CATCH_UP = 60;

/** The most schedules one set of books holds, and lines on each. */
export const MAX_SCHEDULES = 50;
export const MAX_SCHEDULE_LINES = 30;

export interface RecurringInvoice {
  /** Stable identity, so a schedule can be edited without losing its place. */
  id: string;
  contact: string;
  reference: string;
  email?: string;
  entityId?: string;
  currency: string;
  lines: InvoiceLine[];
  frequency: RecurringFrequency;
  /** The date of the first invoice. Every later date is counted from it. */
  start: IsoDate;
  /** No invoice is made dated after this. Null runs until stopped. */
  end: IsoDate | null;
  /** How many invoices this schedule has made. */
  made: number;
  /** Days from the invoice date to the due date; null for no due date. */
  dueDays: number | null;
  active: boolean;
}

function parts(date: IsoDate): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y ?? 0, m ?? 1, d ?? 1];
}

function iso(y: number, m: number, d: number): IsoDate {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** A date some days on, in whole days. */
export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The date of the `n`th invoice of a schedule, counting the first as 0. */
export function occurrence(start: IsoDate, frequency: RecurringFrequency, n: number): IsoDate {
  if (frequency === "weekly") return addDays(start, 7 * n);
  if (frequency === "fortnightly") return addDays(start, 14 * n);

  const months = frequency === "monthly" ? n : frequency === "quarterly" ? 3 * n : 12 * n;
  const [y, m, d] = parts(start);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return iso(year, month, Math.min(d, daysInMonth(year, month)));
}

/** The date this schedule's next invoice carries, or null once it has ended. */
export function nextDate(schedule: RecurringInvoice): IsoDate | null {
  const at = occurrence(schedule.start, schedule.frequency, schedule.made);
  return schedule.end !== null && at > schedule.end ? null : at;
}

export interface ScheduleProblem {
  id: string;
  contact: string;
  message: string;
}

/** What is wrong with a schedule that would stop it making an invoice, if anything. */
export function scheduleProblem(schedule: RecurringInvoice): string | null {
  if (schedule.contact.trim() === "") return "it has no contact";
  if (schedule.lines.length === 0) return "it has no lines";
  if (schedule.lines.length > MAX_SCHEDULE_LINES) return `it has more than ${MAX_SCHEDULE_LINES} lines`;
  const total = schedule.lines.reduce((sum, line) => sum + line.gross, 0);
  if (total === 0) return "its lines add up to nothing";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(schedule.start)) return "its start date is not a date";
  return null;
}

export interface RecurringRun {
  /** The invoices made, oldest first, as drafts. */
  invoices: Invoice[];
  /** The schedules as they stand after the run: counts moved on. */
  schedules: RecurringInvoice[];
  /** Schedules that were due and could not make an invoice, and why. */
  skipped: ScheduleProblem[];
}

/**
 * Make every invoice that has come due.
 *
 * Pure: it returns what should be added and the schedules as they would
 * stand, and changes nothing. A schedule that is behind makes every missed
 * invoice, each dated for its own day, up to `MAX_CATCH_UP`; one that cannot
 * make an invoice is skipped and keeps its place, so fixing it catches it up.
 */
export function generateDue(
  schedules: readonly RecurringInvoice[],
  existing: readonly Invoice[],
  asOf: IsoDate,
): RecurringRun {
  const invoices: Invoice[] = [];
  const skipped: ScheduleProblem[] = [];
  const known: Invoice[] = [...existing];

  const out = schedules.map((schedule): RecurringInvoice => {
    if (!schedule.active) return schedule;
    let at = nextDate(schedule);
    if (at === null || at > asOf) return schedule;

    const problem = scheduleProblem(schedule);
    if (problem !== null) {
      skipped.push({ id: schedule.id, contact: schedule.contact, message: problem });
      return schedule;
    }

    let made = schedule.made;
    let count = 0;
    const total = schedule.lines.reduce((sum, line) => sum + line.gross, 0);
    const tax = schedule.lines.reduce((sum, line) => sum + line.tax, 0);

    while (at !== null && at <= asOf && count < MAX_CATCH_UP) {
      const invoice: Invoice = {
        number: nextInvoiceNumber("sales", known),
        kind: "sales",
        contact: schedule.contact,
        reference: schedule.reference,
        issued: at,
        due: schedule.dueDays === null ? null : addDays(at, schedule.dueDays),
        total,
        tax,
        paid: 0,
        outstanding: total,
        currency: schedule.currency,
        status: "Draft",
        lines: schedule.lines.map((line) => ({ ...line })),
        ...(schedule.email !== undefined && schedule.email !== "" ? { email: schedule.email } : {}),
        ...(schedule.entityId !== undefined ? { entityId: schedule.entityId } : {}),
      };
      invoices.push(invoice);
      known.push(invoice);
      made += 1;
      count += 1;
      at = nextDate({ ...schedule, made });
    }
    return { ...schedule, made };
  });

  return { invoices, schedules: out, skipped };
}

/** A schedule begun from an invoice that was already written. */
export function scheduleFromInvoice(
  invoice: Invoice,
  frequency: RecurringFrequency,
  start: IsoDate,
  id: string,
): RecurringInvoice {
  const dueDays =
    invoice.due === null
      ? null
      : Math.max(0, Math.round((Date.parse(invoice.due) - Date.parse(invoice.issued)) / 86_400_000));
  return {
    id,
    contact: invoice.contact,
    reference: invoice.reference,
    ...(invoice.email !== undefined ? { email: invoice.email } : {}),
    ...(invoice.entityId !== undefined ? { entityId: invoice.entityId } : {}),
    currency: invoice.currency,
    lines: invoice.lines.map((line) => ({ ...line })),
    frequency,
    start,
    end: null,
    made: 0,
    dueDays,
    active: true,
  };
}
