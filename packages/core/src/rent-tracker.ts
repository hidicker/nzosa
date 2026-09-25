import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { PostedJournal } from "./posting.js";

/**
 * Rent owed against rent paid, for each tenancy.
 *
 * Not accounting: nothing here posts. It is the landlord's question -- are the
 * tenants up to date? -- answered by setting what was due (from the start
 * date, the frequency and every change of rent) against what the books show
 * arriving in the rent account. Rent in New Zealand is paid in advance, so
 * each period's rent falls due on its first day.
 */

export type RentFrequency = "weekly" | "fortnightly" | "monthly";

export interface RentChange {
  /** The first day the amount applies. */
  from: IsoDate;
  /** Rent per period, as the tenant pays it (including GST where charged). */
  amount: Cents;
}

export interface Bond {
  amount: Cents;
  paidOn?: IsoDate | undefined;
  /** Lodged with Tenancy Services (residential), and its bond number. */
  lodgedOn?: IsoDate | undefined;
  reference?: string | undefined;
}

export interface Tenancy {
  id: string;
  entityId: string;
  tenant: string;
  start: IsoDate;
  end?: IsoDate | undefined;
  frequency: RentFrequency;
  /** The rent, and each change to it, in date order or not. */
  rents: RentChange[];
  bond?: Bond | undefined;
  /** Chart codes rent for this tenancy is coded to. */
  accounts: string[];
  /**
   * Words that pick this tenant's payments out of the rent account, where
   * one account holds more than one tenancy. Matched against the journal's
   * narration and line descriptions, ignoring case. Empty takes everything.
   */
  payer?: string | undefined;
}

export interface RentPeriod {
  due: IsoDate;
  amount: Cents;
  /** Received on or after this period's due date and before the next. */
  paid: Cents;
  /** Everything due to date less everything paid to date; positive is owed. */
  balance: Cents;
}

export interface RentPosition {
  tenancy: Tenancy;
  asAt: IsoDate;
  periods: RentPeriod[];
  totalDue: Cents;
  totalPaid: Cents;
  /** Positive: behind by this much. Negative: in advance. */
  balance: Cents;
  /** The last day the rent paid covers. */
  paidTo: IsoDate | null;
  /** The balance in periods of the current rent, to one decimal. */
  periodsBehind: number;
  receipts: { date: IsoDate; amount: Cents; narration: string }[];
  notes: string[];
}

function parts(date: IsoDate): [number, number, number] {
  return date.split("-").map(Number) as [number, number, number];
}

function iso(y: number, m: number, d: number): IsoDate {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.toISOString().slice(0, 10);
}

function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = parts(date);
  return iso(y, m, d + days);
}

function daysBetween(a: IsoDate, b: IsoDate): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** The nth due date from the start: a month on keeps the day, or the month's last. */
export function rentDueDate(start: IsoDate, frequency: RentFrequency, n: number): IsoDate {
  if (frequency === "weekly") return addDays(start, 7 * n);
  if (frequency === "fortnightly") return addDays(start, 14 * n);
  const [y, m, d] = parts(start);
  const month = m - 1 + n;
  const year = y + Math.floor(month / 12);
  const mm = (month % 12) + 1;
  const last = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  return iso(year, mm, Math.min(d, last));
}

/**
 * The rent that applies on a date: the latest change on or before it. Before
 * any change, the first rent -- which runs from the start of the tenancy,
 * whatever date it was entered with.
 */
export function rentOn(rents: readonly RentChange[], date: IsoDate): Cents {
  const sorted = [...rents].sort((a, b) => a.from.localeCompare(b.from));
  let amount = sorted[0]?.amount ?? 0;
  for (const r of sorted) if (r.from <= date) amount = r.amount;
  return amount;
}

/** How far before the start a payment still counts: rent paid in advance, or on signing. */
export const PAID_BEFORE_START_DAYS = 90;

/** Rent received for a tenancy, from what the books posted to its accounts. */
export function rentReceipts(
  tenancy: Tenancy,
  journals: readonly PostedJournal[],
): { date: IsoDate; amount: Cents; narration: string }[] {
  const accounts = new Set(tenancy.accounts.map((c) => c.trim()));
  const words = (tenancy.payer ?? "").toLowerCase().split(/[,;]/).map((w) => w.trim()).filter((w) => w !== "");
  const out: { date: IsoDate; amount: Cents; narration: string }[] = [];
  for (const journal of journals) {
    // Rent is paid in advance, often before the tenancy starts.
    if (journal.date < addDays(tenancy.start, -PAID_BEFORE_START_DAYS)) continue;
    if (tenancy.end !== undefined && journal.date > addDays(tenancy.end, 31)) continue;
    let amount = 0;
    const said: string[] = [journal.narration];
    for (const line of journal.lines) {
      if (!accounts.has(line.accountCode.trim())) continue;
      // Rent is a credit. Where GST was charged the supply line carries the
      // GST-inclusive amount the tenant actually paid.
      amount += line.taxBase !== undefined ? line.taxBase : -line.amount;
      said.push(line.description);
    }
    if (amount === 0) continue;
    if (words.length > 0) {
      const text = said.join(" ").toLowerCase();
      if (!words.some((w) => text.includes(w))) continue;
    }
    out.push({ date: journal.date, amount, narration: journal.narration });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Where a tenancy stands on a date.
 *
 * Each period's rent is due on its first day. What was paid is set against
 * what was due, oldest first, so the balance says how far behind or ahead the
 * tenant is, and `paidTo` the last day their payments cover.
 */
export function rentPosition(
  tenancy: Tenancy,
  journals: readonly PostedJournal[],
  asAt: IsoDate,
): RentPosition {
  const notes: string[] = [];
  const receipts = rentReceipts(tenancy, journals).filter((r) => r.date <= asAt);
  const last = tenancy.end !== undefined && tenancy.end < asAt ? tenancy.end : asAt;

  const dues: { due: IsoDate; next: IsoDate; amount: Cents }[] = [];
  for (let n = 0; n < 5_000; n++) {
    const due = rentDueDate(tenancy.start, tenancy.frequency, n);
    if (due > last) break;
    const next = rentDueDate(tenancy.start, tenancy.frequency, n + 1);
    let amount = rentOn(tenancy.rents, due);
    // A tenancy ending part way through a period owes that part of it.
    if (tenancy.end !== undefined && tenancy.end < addDays(next, -1)) {
      const days = daysBetween(due, next);
      amount = Math.round((amount * (daysBetween(due, tenancy.end) + 1)) / days);
    }
    dues.push({ due, next, amount });
  }

  let due = 0;
  let paid = 0;
  const periods: RentPeriod[] = dues.map((d, i) => {
    const until = i + 1 < dues.length ? dues[i + 1]!.due : addDays(asAt, 1);
    const inPeriod = receipts
      .filter((r) => (i === 0 ? r.date < until : r.date >= d.due && r.date < until))
      .reduce((s, r) => s + r.amount, 0);
    due += d.amount;
    paid += inPeriod;
    return { due: d.due, amount: d.amount, paid: inPeriod, balance: due - paid };
  });

  // The last day paid for: walk the periods, spending what was paid.
  let left = paid;
  let paidTo: IsoDate | null = null;
  for (let n = 0; n < 5_000 && left > 0; n++) {
    const from = rentDueDate(tenancy.start, tenancy.frequency, n);
    if (tenancy.end !== undefined && from > tenancy.end) break;
    const next = rentDueDate(tenancy.start, tenancy.frequency, n + 1);
    const amount = rentOn(tenancy.rents, from);
    if (amount <= 0) break;
    if (left >= amount) {
      left -= amount;
      paidTo = addDays(next, -1);
    } else {
      const days = daysBetween(from, next);
      paidTo = addDays(from, Math.floor((left / amount) * days) - 1);
      left = 0;
    }
  }
  if (paidTo !== null && tenancy.end !== undefined && paidTo > tenancy.end) paidTo = tenancy.end;

  const balance = due - paid;
  const current = rentOn(tenancy.rents, last);
  if (tenancy.rents.length === 0) notes.push("No rent is set for this tenancy yet.");
  if (receipts.length === 0 && due > 0) {
    notes.push(
      "No rent found in the books for this tenancy. Check the rent account chosen, and the payer " +
        "words if any are set.",
    );
  }

  return {
    tenancy,
    asAt,
    periods,
    totalDue: due,
    totalPaid: paid,
    balance,
    paidTo,
    periodsBehind: current > 0 ? Math.round((balance / current) * 10) / 10 : 0,
    receipts,
    notes,
  };
}

/**
 * Where a bond stands. A residential landlord must lodge a bond with Tenancy
 * Services within 23 working days of receiving it (Residential Tenancies Act
 * 1986, s 19); this counts weekdays only, a day or two generous over holidays.
 */
export function bondStatus(bond: Bond | undefined, residential: boolean, asAt: IsoDate): string {
  if (bond === undefined || bond.amount <= 0) return "No bond recorded.";
  if (bond.paidOn === undefined) return "Bond not yet paid.";
  if (bond.lodgedOn !== undefined) {
    return `Paid ${bond.paidOn}, lodged ${bond.lodgedOn}${bond.reference ? ` (bond ${bond.reference})` : ""}.`;
  }
  if (!residential) return `Paid ${bond.paidOn}; held by the landlord.`;
  let working = 0;
  let day = bond.paidOn;
  while (day < asAt && working <= 23) {
    day = addDays(day, 1);
    const [y, m, d] = parts(day);
    const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (w !== 0 && w !== 6) working += 1;
  }
  return working > 23
    ? `Paid ${bond.paidOn} and not lodged: a residential bond must be lodged with Tenancy Services within 23 working days.`
    : `Paid ${bond.paidOn}; lodge it with Tenancy Services within 23 working days of that.`;
}
