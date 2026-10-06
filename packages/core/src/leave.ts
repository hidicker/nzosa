import type { IsoDate } from "./dates.js";
import type { Cents } from "./money.js";

/**
 * Leave under the Holidays Act 2003: what each employee is owed, and what it
 * is worth.
 *
 * The parts a bookkeeper keeps, as the Act sets them:
 *
 *  * **Annual holidays**: four weeks at each anniversary of starting, held in
 *    weeks because the Act counts them in weeks. Before an anniversary they
 *    are not yet an entitlement, but 8% of the gross earned since the last one
 *    is owed if the job ends -- which is why it is a liability at balance date.
 *    Paid at the greater of ordinary weekly pay and average weekly earnings
 *    over the last 12 months.
 *  * **Sick leave**: 10 days once six months of current continuous employment
 *    is reached, and 10 more each 12 months after; unused days carry over, but
 *    a balance is not topped up beyond 20.
 *  * **Pay as you go**: for someone whose agreement adds 8% to each pay --
 *    casual, or fixed-term under 12 months -- there is no annual balance to
 *    keep, and nothing is owed at balance date.
 *
 * What this does not decide: whether a particular payment counts as gross
 * earnings, what a week means for somebody with no regular pattern, and the
 * relevant daily pay for sick and public holidays. Those are judgements the
 * Act leaves unclear, and the figures here say what they assumed.
 */

export type LeaveKind =
  | "annual"
  | "sick"
  | "family-violence"
  | "bereavement"
  | "alternative"
  | "alternative-earned"
  | "annual-cashup"
  | "parental"
  | "other";

export interface LeaveTaken {
  employeeId: string;
  kind: LeaveKind;
  /** First day away. */
  from: IsoDate;
  /** Last day away, where the leave runs over several days. */
  to?: IsoDate;
  /** Working days taken: annual leave is turned into weeks by the days the employee works a week. */
  days: number;
  note?: string;
}

export interface LeaveSettings {
  employeeId: string;
  /** Days worked in a usual week, to turn days of annual leave into weeks. Default 5. */
  daysPerWeek?: number;
  /** Hours worked in a usual week, for leave in hours as payroll keeps it. Default 40. */
  hoursPerWeek?: number;
  /** The region whose anniversary day is a public holiday for this employee (Xero's holiday group). */
  region?: string;
  /** 8% added to every pay instead of annual holidays (casual, or fixed-term under a year). */
  payAsYouGo?: boolean;
  /** Balances carried in from before these records, as at a date. */
  opening?: { asAt: IsoDate; annualWeeks: number; sickDays: number };
}

export interface LeaveBalance {
  employeeId: string;
  asAt: IsoDate;
  payAsYouGo: boolean;
  /** Weeks of annual holidays owed and not yet taken. */
  annualWeeks: number;
  annualEntitledWeeks: number;
  annualTakenWeeks: number;
  /** The last anniversary on or before the date, or the start date if none yet. */
  lastAnniversary: IsoDate | null;
  nextAnniversary: IsoDate | null;
  /** Gross earned since the last anniversary, and the 8% of it owed if employment ended. */
  grossSinceAnniversary: Cents;
  accruedSinceAnniversary: Cents;
  sickDays: number;
  /** When the next 10 days of sick leave arrive. */
  nextSickEntitlement: IsoDate | null;
  /** Family violence leave left this year: 10 days from each entitlement date, not carried over. */
  familyViolenceDays: number;
  /** Alternative holidays (days in lieu) earned and not yet taken. */
  alternativeDays: number;
  /** Hours a usual week and day, for showing balances in hours. */
  hoursPerWeek: number;
  hoursPerDay: number;
  /** Ordinary weekly pay, as the employment agreement sets it. */
  ordinaryWeeklyPay: Cents;
  /** Gross earnings over the 12 months to the date, divided by 52. */
  averageWeeklyEarnings: Cents;
  /** The weekly rate annual holidays are paid at: the greater of the two. */
  weeklyRate: Cents;
  /** Holiday pay owing at the date: weeks owed at the weekly rate, plus the 8% accrued. */
  owing: Cents;
  notes: string[];
}

function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10) as IsoDate;
}

export function leaveBalance(options: {
  employeeId: string;
  startDate: IsoDate;
  asAt: IsoDate;
  settings?: LeaveSettings;
  /** Gross pay by date paid, for this employee. */
  pays: readonly { date: IsoDate; gross: Cents }[];
  taken: readonly LeaveTaken[];
  /** Ordinary weekly pay, from the salary or the hourly rate and usual hours. */
  ordinaryWeeklyPay: Cents;
}): LeaveBalance {
  const { employeeId, startDate, asAt } = options;
  const settings = options.settings;
  const daysPerWeek = settings?.daysPerWeek && settings.daysPerWeek > 0 ? settings.daysPerWeek : 5;
  const payAsYouGo = settings?.payAsYouGo === true;
  const opening = settings?.opening;
  const notes: string[] = [];
  const mine = options.taken.filter((t) => t.employeeId === employeeId && t.from <= asAt);

  // --- annual holidays ---
  // Entitlements arise at each anniversary; with an opening balance, only the
  // anniversaries after its date add to it.
  let annualEntitled = opening?.annualWeeks ?? 0;
  let lastAnniversary: IsoDate | null = null;
  let nextAnniversary: IsoDate | null = null;
  for (let years = 1; years < 100; years++) {
    const anniversary = addMonths(startDate, years * 12);
    if (anniversary > asAt) {
      nextAnniversary = anniversary;
      break;
    }
    lastAnniversary = anniversary;
    if (!payAsYouGo && (opening === undefined || anniversary > opening.asAt)) annualEntitled += 4;
  }
  const since = lastAnniversary ?? startDate;
  const annualTakenDays = mine
    // Leave taken and leave cashed up both come off the annual balance.
    .filter((t) => (t.kind === "annual" || t.kind === "annual-cashup") && (opening === undefined || t.from > opening.asAt))
    .reduce((s, t) => s + t.days, 0);
  const annualTaken = annualTakenDays / daysPerWeek;
  const annualWeeks = payAsYouGo ? 0 : annualEntitled - annualTaken;
  if (annualWeeks < 0) notes.push("More annual leave has been taken than is owed: leave in advance, by agreement.");

  const grossSinceAnniversary = options.pays
    .filter((p) => p.date >= since && p.date <= asAt)
    .reduce((s, p) => s + p.gross, 0);
  const accruedSinceAnniversary = payAsYouGo ? 0 : Math.round(grossSinceAnniversary * 0.08);

  // --- sick leave ---
  let sickDays = opening?.sickDays ?? 0;
  let nextSickEntitlement: IsoDate | null = null;
  const sickTakenAll = mine.filter((t) => t.kind === "sick");
  // Walk the entitlement dates in order, taking off sick days used before each.
  const sickDates: IsoDate[] = [];
  for (let n = 0; n < 100; n++) {
    const date = addMonths(startDate, 6 + n * 12);
    if (date > asAt) {
      nextSickEntitlement = date;
      break;
    }
    if (opening === undefined || date > opening.asAt) sickDates.push(date);
  }
  let cursor: IsoDate = opening?.asAt ?? startDate;
  const takenBetween = (from: IsoDate, to: IsoDate): number =>
    sickTakenAll.filter((t) => t.from > from && t.from <= to).reduce((s, t) => s + t.days, 0);
  for (const date of sickDates) {
    sickDays -= takenBetween(cursor, date);
    // A new 10 days, but a balance is not topped up past 20.
    sickDays = Math.max(sickDays, Math.min(sickDays + 10, 20));
    cursor = date;
  }
  sickDays -= takenBetween(cursor, asAt);

  // Family violence leave: the same eligibility as sick leave, 10 days a
  // year, and none of it carried over.
  const lastSickDate = sickDates[sickDates.length - 1] ?? (addMonths(startDate, 6) <= asAt ? addMonths(startDate, 6) : null);
  const familyViolenceDays =
    lastSickDate === null
      ? 0
      : 10 - mine.filter((t) => t.kind === "family-violence" && t.from >= lastSickDate).reduce((s, t) => s + t.days, 0);

  // Alternative holidays: a day earned for each public holiday worked that
  // would otherwise have been a working day, kept until taken.
  const alternativeDays =
    mine.filter((t) => t.kind === "alternative-earned").reduce((s, t) => s + t.days, 0) -
    mine.filter((t) => t.kind === "alternative").reduce((s, t) => s + t.days, 0);
  const hoursPerWeek = settings?.hoursPerWeek && settings.hoursPerWeek > 0 ? settings.hoursPerWeek : 40;

  // --- what it is worth ---
  const yearAgo = addMonths(asAt, -12);
  const lastYear = options.pays.filter((p) => p.date > yearAgo && p.date <= asAt).reduce((s, p) => s + p.gross, 0);
  const averageWeeklyEarnings = Math.round(lastYear / 52);
  const ordinaryWeeklyPay = options.ordinaryWeeklyPay;
  const weeklyRate = Math.max(ordinaryWeeklyPay, averageWeeklyEarnings);
  if (startDate > yearAgo) {
    notes.push("Employed less than 12 months: average weekly earnings are over a part year, so ordinary weekly pay usually applies.");
  }
  const owing = payAsYouGo ? 0 : Math.round(Math.max(annualWeeks, 0) * weeklyRate) + accruedSinceAnniversary;

  return {
    employeeId,
    asAt,
    payAsYouGo,
    annualWeeks,
    annualEntitledWeeks: annualEntitled,
    annualTakenWeeks: annualTaken,
    lastAnniversary,
    nextAnniversary,
    grossSinceAnniversary: grossSinceAnniversary as Cents,
    accruedSinceAnniversary: accruedSinceAnniversary as Cents,
    sickDays,
    nextSickEntitlement,
    familyViolenceDays,
    alternativeDays,
    hoursPerWeek,
    hoursPerDay: hoursPerWeek / daysPerWeek,
    ordinaryWeeklyPay,
    averageWeeklyEarnings: averageWeeklyEarnings as Cents,
    weeklyRate: weeklyRate as Cents,
    owing: owing as Cents,
    notes,
  };
}

/** Ordinary weekly pay from what the employment agreement sets: a salary, or a rate and usual hours. */
export function ordinaryWeeklyPayOf(employee: {
  annualSalary?: Cents | undefined;
  hourlyRate?: Cents | undefined;
  standardHours?: number | undefined;
  payFrequency: "weekly" | "fortnightly" | "four-weekly" | "monthly";
}): Cents {
  if (employee.annualSalary !== undefined && employee.annualSalary > 0) return Math.round(employee.annualSalary / 52) as Cents;
  if (employee.hourlyRate !== undefined && employee.standardHours !== undefined) {
    // Usual hours are per pay period; a week's worth of them.
    const weeks = { weekly: 1, fortnightly: 2, "four-weekly": 4, monthly: 52 / 12 }[employee.payFrequency];
    return Math.round((employee.hourlyRate * employee.standardHours) / weeks) as Cents;
  }
  return 0 as Cents;
}
