import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { PostedJournal, PostedLine } from "./posting.js";

/**
 * Payroll: PAYE and the other deductions, the payday filing file, and the
 * journal a pay run posts.
 *
 * The arithmetic follows Inland Revenue's "Payroll Calculations & Business
 * Rules Specification" for 1 April 2026 to 31 March 2027, step by step --
 * including where it truncates and where it drops cents, because a payroll
 * that is right to the dollar and wrong by a cent is a payroll whose filings
 * do not match what IR works out. The tests check it against the figures in
 * IR's own casebook for that year.
 *
 * The file is the Employment Information (EI) return in the HEI2/DEI layout of
 * IR's "Payday Filing File Upload Specification" for the same year.
 */

/** The tax codes an employee can give on an IR330, as the EI file writes them. */
export type TaxCode =
  | "M"
  | "ME"
  | "M SL"
  | "ME SL"
  | "SB"
  | "S"
  | "SH"
  | "ST"
  | "SA"
  | "SB SL"
  | "S SL"
  | "SH SL"
  | "ST SL"
  | "SA SL"
  | "CAE"
  | "EDW"
  | "ND"
  | "NSW"
  | "STC"
  | "WT";

export type PayFrequency = "weekly" | "fortnightly" | "four-weekly" | "monthly";

export interface Employee {
  id: string;
  name: string;
  /** Bare digits. Empty for somebody who has not given one -- they are taxed at ND. */
  irdNumber: string;
  taxCode: TaxCode;
  payFrequency: PayFrequency;
  hourlyRate?: Cents | undefined;
  annualSalary?: Cents | undefined;
  standardHours?: number | undefined;
  /** KiwiSaver employee deduction, e.g. 0.035; 0 if not a member. */
  kiwiSaverRate: number;
  /** Employer contribution, e.g. 0.035; 0 if not a member. */
  kiwiSaverEmployerRate: number;
  /**
   * ESCT rate on the employer's contribution, set at the start of each tax
   * year from the ESCT rate threshold amount. 0 means work it out from this
   * employee's pay; see `esctRateFor`.
   */
  esctRate: number;
  /**
   * The rate for a WT (schedular payment) or STC (tailored tax code) payee:
   * the rate they elected on their IR330C, or the one on the certificate --
   * which, for STC, already includes the ACC earners' levy.
   */
  taxRate?: number | undefined;
  /**
   * A student loan special deduction rate from IR's certificate, in place of
   * the standard 12% (0 under a repayment deduction exemption).
   */
  studentLoanRate?: number | undefined;
  /** Commissioner deductions (SLCIR) IR has asked for: a rate, at most 5%. */
  slcirRate?: number | undefined;
  /** Voluntary extra student loan deductions (SLBOR), an amount each pay. */
  slborAmount?: Cents | undefined;
  /** A higher rate the employee has chosen for extra pays (RD 10(2)). */
  extraPayRate?: number | undefined;
  bankAccount: string;
  startDate?: IsoDate | undefined;
  finishDate?: IsoDate | undefined;
}

/**
 * What kind of extra pay: a bonus or other lump sum; one arising from the end
 * of employment (final holiday pay, say); or a redundancy or retiring payment,
 * which also ends employment and carries no ACC earners' levy or KiwiSaver.
 */
export type ExtraPayKind = "bonus" | "termination" | "redundancy";

export interface PayLineInput {
  employeeId: string;
  hoursWorked?: number | undefined;
  grossOverride?: Cents | undefined;
  earningsNotLiableAcc?: Cents | undefined;
  /** What IR's deduction notice asks for; capped at 40% of net pay. */
  childSupport?: Cents | undefined;
  /** A lump sum paid with this pay, taxed as an extra pay. */
  extraPay?: Cents | undefined;
  extraPayKind?: ExtraPayKind | undefined;
  /** Donations through a payroll giving scheme. */
  payrollDonation?: Cents | undefined;
  /** An employee share scheme benefit, reported only; no PAYE is withheld on it here. */
  ess?: Cents | undefined;
  /** Corrections to an earlier pay, reported in the prior period fields. */
  priorGross?: Cents | undefined;
  priorPaye?: Cents | undefined;
}

export interface PayLine {
  employeeId: string;
  employeeName: string;
  irdNumber: string;
  taxCode: TaxCode;
  frequency?: PayFrequency | undefined;
  /** Hours paid, where the employee is paid by the hour. */
  hours?: number | undefined;
  gross: Cents;
  earningsNotLiableAcc: Cents;
  paye: Cents;
  studentLoan: Cents;
  kiwiSaverEmployee: Cents;
  /** The employer's contribution before ESCT -- what it costs the employer. */
  kiwiSaverEmployer: Cents;
  /** The employer's contribution after ESCT -- what reaches the fund. */
  kiwiSaverEmployerNet?: Cents | undefined;
  esct: Cents;
  childSupport: Cents;
  /** "P" when child support was cut to protect 60% of net pay. */
  childSupportCode?: string | undefined;
  /** The extra pay within `gross`, and whether it was taxed at the lowest rate. */
  extraPay?: Cents | undefined;
  lumpSumLowRate?: boolean | undefined;
  slcir?: Cents | undefined;
  slbor?: Cents | undefined;
  payrollDonation?: Cents | undefined;
  /** Tax credit for the donation, a third of it, taken off PAYE paid to IR. */
  donationCredit?: Cents | undefined;
  ess?: Cents | undefined;
  priorGross?: Cents | undefined;
  priorPaye?: Cents | undefined;
  netPay: Cents;
  startDate?: IsoDate | undefined;
  finishDate?: IsoDate | undefined;
}

export interface PayRun {
  id: string;
  employerIrd: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  payDate: IsoDate;
  /** The tax year whose rates were used, named by the 31 March it ends on. */
  taxYear?: number | undefined;
  lines: PayLine[];
  totalGross: Cents;
  totalPaye: Cents;
  totalStudentLoan: Cents;
  totalKiwiSaverEmployee: Cents;
  totalKiwiSaverEmployer: Cents;
  totalKiwiSaverEmployerNet?: Cents | undefined;
  totalEsct: Cents;
  totalChildSupport: Cents;
  totalSlcir?: Cents | undefined;
  totalSlbor?: Cents | undefined;
  totalDonations?: Cents | undefined;
  totalDonationCredits?: Cents | undefined;
  totalEss?: Cents | undefined;
  totalPriorGross?: Cents | undefined;
  totalPriorPaye?: Cents | undefined;
  totalNetPay: Cents;
  /** Anything about the rates used that somebody should know. */
  notes?: string[] | undefined;
}

// --- IRD numbers -------------------------------------------------------------

/**
 * Inland Revenue's modulus-11 check on an IRD number.
 *
 * 8 or 9 digits, in the range IR allocates (10-000-000 to 150-000-000), with
 * the primary weights and, where they give 10, the secondary ones.
 */
export function isValidIrdNumber(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 8 && digits.length !== 9) return false;

  const padded = digits.padStart(9, "0");
  const num = Number(padded);
  if (num < 10_000_000 || num > 150_000_000) return false;

  const d = padded.split("").map(Number);
  const checkDigit = d[8] ?? 0;
  const weighted = (weights: number[]): number => {
    let sum = 0;
    for (let i = 0; i < 8; i++) sum += (d[i] ?? 0) * (weights[i] ?? 0);
    const remainder = sum % 11;
    return remainder === 0 ? 0 : 11 - remainder;
  };

  let calculated = weighted([3, 2, 7, 6, 5, 4, 3, 2]);
  if (calculated === 10) {
    calculated = weighted([7, 4, 3, 2, 5, 2, 7, 6]);
    if (calculated === 10) return false;
  }
  return calculated === checkDigit;
}

/** An IRD number as bare digits. */
export function cleanIrdNumber(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** An IRD number as people write it, 12-345-678 or 123-456-789. */
export function formatIrdNumber(raw: string): string {
  const digits = cleanIrdNumber(raw);
  if (digits.length === 8) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
  if (digits.length === 9) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return raw;
}

// --- the rates -----------------------------------------------------------------

interface PayrollRates {
  /** ACC earners' levy, as a fraction. */
  levy: number;
  /** Earnings at which the levy stops, in dollars, and the most it can be. */
  levyCap: number;
  levyMax: number;
  /** The default KiwiSaver rate for employee and employer. */
  kiwiSaverDefault: number;
}

/**
 * By tax year. The income tax bands are the ones in force from 31 July 2024,
 * which both years share; the levy and KiwiSaver moved on 1 April 2026.
 */
const RATES: Readonly<Record<number, PayrollRates>> = {
  2026: { levy: 0.0167, levyCap: 152_790, levyMax: 2_551.59, kiwiSaverDefault: 0.03 },
  2027: { levy: 0.0175, levyCap: 156_641, levyMax: 2_741.22, kiwiSaverDefault: 0.035 },
  // 2027-28: IRD's published levy (1.83%, to $160,244, at most $2,932.47);
  // the bands and KiwiSaver unchanged. IR's payroll specification for the
  // year comes out in March -- check it against these then.
  2028: { levy: 0.0183, levyCap: 160_244, levyMax: 2_932.47, kiwiSaverDefault: 0.035 },
};
const FIRST_YEAR = 2026;
const LAST_YEAR = 2028;

/** Whether payroll rates are held for a tax year, for the yearly test. */
export function payrollRatesHeld(year: number): boolean {
  return RATES[year] !== undefined;
}

/** The tax year a payday falls in, named by the 31 March it ends on. */
export function payrollTaxYear(payDate: IsoDate): number {
  const year = Number(payDate.slice(0, 4));
  return payDate.slice(5) > "03-31" ? year + 1 : year;
}

function ratesFor(year: number): { rates: PayrollRates; note: string | null } {
  const held = RATES[year];
  if (held !== undefined) return { rates: held, note: null };
  const nearest = year < FIRST_YEAR ? FIRST_YEAR : LAST_YEAR;
  return {
    rates: RATES[nearest] as PayrollRates,
    note:
      `No payroll rates are held for the year to 31 March ${year}; the ` +
      `${nearest - 1}-${String(nearest).slice(2)} rates were used. Check them before filing.`,
  };
}

/** The KiwiSaver default contribution rate for a payday. */
export function kiwiSaverDefaultRate(payDate: IsoDate): number {
  return ratesFor(payrollTaxYear(payDate)).rates.kiwiSaverDefault;
}

/** Pays in a year. */
function paysPerYear(frequency: PayFrequency): number {
  switch (frequency) {
    case "weekly":
      return 52;
    case "fortnightly":
      return 26;
    case "four-weekly":
      return 13;
    case "monthly":
      return 12;
  }
}

/** Truncate a figure in cents to whole cents, as the specification asks everywhere. */
function truncCents(cents: number): Cents {
  // The small nudge keeps 15730.000000001 from becoming 15729 through binary
  // floating point; nothing the rules produce comes within a millionth of a
  // cent of a boundary otherwise.
  return Math.floor(cents + 1e-6);
}

/** Drop the cents: the pay period amount in whole dollars, as cents. */
function wholeDollars(cents: Cents): Cents {
  return Math.floor(cents / 100) * 100;
}

/** Income tax on an annual income in whole dollars, as the specification's formulas. */
function annualTax(income: number): number {
  if (income <= 0) return 0;
  if (income <= 15_600) return income * 0.105;
  if (income <= 53_500) return income * 0.175 - 1_092;
  if (income <= 78_100) return income * 0.3 - 7_779.5;
  if (income <= 180_000) return income * 0.33 - 10_122.5;
  return income * 0.39 - 20_922.5;
}

/** The independent earner tax credit on an annual income, in dollars. */
function annualIetc(income: number): number {
  if (income < 24_000 || income >= 70_000) return 0;
  if (income <= 66_000) return 520;
  return 520 - (income - 66_000) * 0.13;
}

/** Flat rates, before the ACC earners' levy. */
const FLAT_RATES: Partial<Record<TaxCode, number>> = {
  SB: 0.105,
  "SB SL": 0.105,
  S: 0.175,
  "S SL": 0.175,
  SH: 0.3,
  "SH SL": 0.3,
  ST: 0.33,
  "ST SL": 0.33,
  SA: 0.39,
  "SA SL": 0.39,
  CAE: 0.175,
  EDW: 0.175,
  ND: 0.45,
  NSW: 0.105,
};

const PRIMARY: ReadonlySet<TaxCode> = new Set(["M", "ME", "M SL", "ME SL"]);
const SECONDARY_SL: ReadonlySet<TaxCode> = new Set(["SB SL", "S SL", "SH SL", "ST SL", "SA SL"]);

/** Student loan pay period thresholds, $24,128 a year, in cents. */
const SL_THRESHOLD: Readonly<Record<PayFrequency, Cents>> = {
  weekly: 46_400,
  fortnightly: 92_800,
  "four-weekly": 185_600,
  monthly: 201_066,
};

/**
 * PAYE on a main-income pay, sections 5.2 and 5.3.
 *
 * Annualise and drop the cents; tax, levy and (for ME) the credit on the
 * year; a weekly figure truncated to cents; and that weekly figure converted
 * to the pay's own frequency, truncated again. The weekly step is IR's, and
 * skipping it gives a different cent on fortnightly and monthly pays.
 */
function primaryPaye(gross: Cents, frequency: PayFrequency, code: TaxCode, rates: PayrollRates): Cents {
  const pays = paysPerYear(frequency);
  const annual = Math.floor((gross * pays) / 100 + 1e-9);
  const levy = annual < rates.levyCap ? annual * rates.levy : rates.levyMax;
  const credit = code === "ME" || code === "ME SL" ? annualIetc(annual) : 0;
  const total = Math.max(0, annualTax(annual) + levy - credit);
  const weekly = truncCents((total * 100) / 52);
  return pays === 52 ? weekly : truncCents((weekly * 52) / pays);
}

/**
 * The ESCT rate for an employee, from the ESCT rate threshold amount: last
 * year's salary or wages plus the employer's gross superannuation
 * contributions, or an estimate of this year's for somebody not employed for
 * the whole of last year. Rates from 1 April 2025.
 */
export function esctRateFor(thresholdAmount: Cents): number {
  const dollars = thresholdAmount / 100;
  if (dollars <= 18_720) return 0.105;
  if (dollars <= 64_200) return 0.175;
  if (dollars <= 93_720) return 0.3;
  if (dollars <= 216_000) return 0.33;
  return 0.39;
}

/** The lowest dollar of each secondary code's band, for an extra pay (5.11.2). */
const LOW_THRESHOLD: Partial<Record<TaxCode, number>> = {
  SB: 0, "SB SL": 0, S: 15_601, "S SL": 15_601, SH: 53_501, "SH SL": 53_501,
  ST: 78_101, "ST SL": 78_101, SA: 180_001, "SA SL": 180_001,
};

/** The band rate for an extra pay's grossed-up amount, in whole dollars. */
function extraPayBand(grossed: number): number {
  if (grossed > 180_000) return 0.39;
  if (grossed > 78_100) return 0.33;
  if (grossed > 53_500) return 0.3;
  if (grossed > 15_600) return 0.175;
  return 0.105;
}

/**
 * Tax on an extra pay (sections 5.11 and 5.12).
 *
 * The rate comes from the employee's pay annualised, plus the extra pay (plus
 * the bottom of their secondary band, for a secondary code); the tax is that
 * rate on the extra pay alone, plus the earners' levy on as much of it as
 * falls under the levy's ceiling.
 */
export function extraPayTax(options: {
  code: TaxCode;
  extraPay: Cents;
  kind: ExtraPayKind;
  /** The employee's pay annualised as the section says, in cents. */
  annualised: Cents;
  electedRate?: number | undefined;
  year: number;
}): { tax: Cents; rate: number; lowRate: boolean } {
  const { rates } = ratesFor(options.year);
  const extra = options.extraPay;
  const low = LOW_THRESHOLD[options.code] ?? 0;
  const base = options.annualised / 100 + low;
  const grossed = Math.floor(base + extra / 100 + 1e-9);
  const band = extraPayBand(grossed);
  const rate = Math.max(band, options.electedRate ?? 0);
  let levy = 0;
  if (options.kind !== "redundancy" && base < rates.levyCap) {
    const liable = grossed <= rates.levyCap ? extra : (rates.levyCap - base) * 100;
    levy = liable * rates.levy;
  }
  return { tax: truncCents(extra * rate + levy), rate, lowRate: rate === 0.105 };
}

/**
 * The pay an extra pay is annualised from.
 *
 * A bonus: this employee's pay in the four weeks up to and including payday,
 * times 13 (or one monthly pay times 12). An extra pay when employment ends:
 * the last two pay periods before this one, times 26, 13, 6.5 or 6 by how
 * often they are paid -- or the one period there is, annualised. Other extra
 * pays in those periods are left out.
 */
export function annualisedForExtraPay(options: {
  employeeId: string;
  frequency: PayFrequency;
  kind: ExtraPayKind;
  payDate: IsoDate;
  /** This pay's ordinary pay, without the extra pay. */
  thisPay: Cents;
  history: readonly PayRun[];
}): Cents {
  const ordinary = (line: PayLine): Cents => line.gross - (line.extraPay ?? 0);
  const past = options.history
    .filter((run) => run.payDate < options.payDate)
    .flatMap((run) =>
      run.lines.filter((l) => l.employeeId === options.employeeId).map((l) => ({ date: run.payDate, pay: ordinary(l) })),
    )
    .sort((a, b) => b.date.localeCompare(a.date));

  if (options.kind === "bonus") {
    const start = addDaysIso(options.payDate, -27);
    const window = past.filter((p) => p.date >= start).reduce((sum, p) => sum + p.pay, 0) + options.thisPay;
    return options.frequency === "monthly" ? window * 12 : window * 13;
  }
  const lastTwo = past.slice(0, 2);
  if (lastTwo.length === 2) {
    const factor = { weekly: 26, fortnightly: 13, "four-weekly": 6.5, monthly: 6 }[options.frequency];
    return Math.round((lastTwo[0]!.pay + lastTwo[1]!.pay) * factor);
  }
  if (lastTwo.length === 1) return lastTwo[0]!.pay * paysPerYear(options.frequency);
  return 0;
}

function addDaysIso(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/**
 * Work out one employee's pay.
 *
 * `year` is the tax year, named by the 31 March it ends on; a pay run takes
 * it from the payday. `gross` is the ordinary pay; an extra pay comes in
 * `options`, with the annualised pay its rate is found from.
 */
export function calculatePayLine(
  employee: Employee,
  gross: Cents,
  year = LAST_YEAR,
  options?: {
    earningsNotLiableAcc?: Cents | undefined;
    childSupport?: Cents | undefined;
    hours?: number | undefined;
    extraPay?: Cents | undefined;
    extraPayKind?: ExtraPayKind | undefined;
    annualised?: Cents | undefined;
    payrollDonation?: Cents | undefined;
    ess?: Cents | undefined;
    priorGross?: Cents | undefined;
    priorPaye?: Cents | undefined;
  },
): PayLine {
  const { rates } = ratesFor(year);
  const frequency = employee.payFrequency;
  // Nobody is taxed at M without having said so: no IRD number is the
  // no-notification rate, whatever code was typed in.
  const code: TaxCode = employee.irdNumber.trim() === "" && employee.taxCode !== "NSW" ? "ND" : employee.taxCode;
  const extra = options?.extraPay ?? 0;
  const kind = options?.extraPayKind ?? "bonus";
  const total = gross + extra;
  const payDollars = wholeDollars(gross);

  // PAYE on the ordinary pay.
  let paye = 0;
  let earningsNotLiableAcc = options?.earningsNotLiableAcc ?? 0;
  if (PRIMARY.has(code)) {
    paye = primaryPaye(gross, frequency, code, rates);
  } else if (code === "WT") {
    // Schedular payments: the elected (or standard) rate on the payment, no
    // earners' levy, and all of it reported as not liable for the levy.
    paye = truncCents(total * (employee.taxRate ?? 0.45));
    earningsNotLiableAcc = total;
  } else if (code === "STC") {
    // The certificate's rate includes the levy (section 5.11.1, 2.3.1).
    paye = truncCents(payDollars * (employee.taxRate ?? 0));
  } else {
    paye = truncCents(payDollars * ((FLAT_RATES[code] ?? 0.45) + rates.levy));
  }

  // PAYE on an extra pay.
  let lumpSumLowRate = false;
  if (extra > 0 && code !== "WT") {
    if (code === "ND" || code === "NSW") {
      paye += truncCents(extra * ((FLAT_RATES[code] ?? 0.45) + rates.levy));
    } else if (code === "STC") {
      const rate = (employee.taxRate ?? 0) - (kind === "redundancy" ? rates.levy : 0);
      paye += truncCents(extra * rate);
    } else {
      const worked = extraPayTax({
        code,
        extraPay: extra,
        kind,
        annualised: options?.annualised ?? 0,
        electedRate: employee.extraPayRate,
        year,
      });
      paye += worked.tax;
      lumpSumLowRate = worked.lowRate;
    }
    // A redundancy or retiring payment is not liable for the earners' levy.
    if (kind === "redundancy") earningsNotLiableAcc += extra;
  }

  // Student loan, on the pay for the period including any extra pay.
  const slRate = employee.studentLoanRate ?? 0.12;
  const slDollars = wholeDollars(total);
  let studentLoan = 0;
  let slcir = 0;
  if (code === "M SL" || code === "ME SL") {
    const over = slDollars - SL_THRESHOLD[frequency];
    studentLoan = over > 0 ? truncCents(over * slRate) : 0;
    if (over > 0 && employee.slcirRate) slcir = truncCents(over * employee.slcirRate);
  } else if (SECONDARY_SL.has(code)) {
    studentLoan = truncCents(slDollars * slRate);
    if (employee.slcirRate) slcir = truncCents(slDollars * employee.slcirRate);
  }
  const hasLoan = code.endsWith("SL") || code === "STC";
  const slbor = hasLoan ? employee.slborAmount ?? 0 : 0;

  // KiwiSaver: bonuses count; redundancy and share schemes do not (4.5.1).
  // Not for a non-resident seasonal worker, who cannot join, or a schedular
  // payee, who is not an employee.
  const kiwiSaverApplies = code !== "NSW" && code !== "WT";
  const kiwiSaverBase = gross + (kind === "redundancy" ? 0 : extra);
  const kiwiSaverEmployee = kiwiSaverApplies ? truncCents(kiwiSaverBase * employee.kiwiSaverRate) : 0;
  const kiwiSaverEmployer = kiwiSaverApplies ? truncCents(kiwiSaverBase * employee.kiwiSaverEmployerRate) : 0;
  const esctRate =
    employee.esctRate > 0
      ? employee.esctRate
      : esctRateFor((gross + kiwiSaverEmployer) * paysPerYear(frequency));
  // ESCT is worked on the contribution in whole dollars (section 5.20.6).
  const esct = kiwiSaverEmployer > 0 ? truncCents(wholeDollars(kiwiSaverEmployer) * esctRate) : 0;

  // The levy inside PAYE, near enough, for the two rules that need the tax
  // part alone: protected earnings and the payroll giving credit's ceiling.
  const levyPart = code === "WT" ? 0 : truncCents(Math.min(total, (rates.levyCap * 100) / paysPerYear(frequency)) * rates.levy);
  const taxPart = Math.max(0, paye - levyPart);

  // Child support, cut so the employee keeps 60% of net pay (5.15.1).
  const asked = options?.childSupport ?? 0;
  const ceiling = truncCents((total - taxPart) * 0.4);
  const childSupport = Math.min(asked, Math.max(0, ceiling));
  const childSupportCode = asked > childSupport ? "P" : undefined;

  // Payroll giving: a third of the donation back, no more than the tax (5.16).
  const donation = options?.payrollDonation ?? 0;
  const donationCredit = Math.min(truncCents(donation * 0.333333), taxPart);

  const priorGross = options?.priorGross ?? 0;
  const priorPaye = options?.priorPaye ?? 0;

  return {
    employeeId: employee.id,
    employeeName: employee.name,
    irdNumber: cleanIrdNumber(employee.irdNumber),
    taxCode: code,
    frequency,
    ...(options?.hours !== undefined ? { hours: options.hours } : {}),
    gross: total,
    earningsNotLiableAcc: earningsNotLiableAcc + (options?.ess ?? 0),
    paye,
    studentLoan,
    kiwiSaverEmployee,
    kiwiSaverEmployer,
    kiwiSaverEmployerNet: kiwiSaverEmployer - esct,
    esct,
    childSupport,
    ...(childSupportCode !== undefined ? { childSupportCode } : {}),
    ...(extra > 0 ? { extraPay: extra, lumpSumLowRate } : {}),
    ...(slcir > 0 ? { slcir } : {}),
    ...(slbor > 0 ? { slbor } : {}),
    ...(donation > 0 ? { payrollDonation: donation, donationCredit } : {}),
    ...((options?.ess ?? 0) > 0 ? { ess: options?.ess } : {}),
    ...(priorGross !== 0 ? { priorGross } : {}),
    ...(priorPaye !== 0 ? { priorPaye } : {}),
    netPay:
      total + priorGross - (paye - donationCredit) - priorPaye - studentLoan - slcir - slbor -
      kiwiSaverEmployee - childSupport - donation,
    startDate: employee.startDate,
    finishDate: employee.finishDate,
  };
}

/**
 * Assemble a pay run: each employee's line, at the rates for the payday's
 * tax year. `history` is the pay runs already made, which an extra pay is
 * annualised from.
 */
export function buildPayRun(params: {
  id?: string | undefined;
  employerIrd: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  payDate: IsoDate;
  employees: Employee[];
  inputs: PayLineInput[];
  history?: readonly PayRun[] | undefined;
}): PayRun {
  const id = params.id ?? `payrun-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const year = payrollTaxYear(params.payDate);
  const { note } = ratesFor(year);
  const employeeMap = new Map(params.employees.map((e) => [e.id, e]));
  const lines: PayLine[] = [];

  for (const input of params.inputs) {
    const emp = employeeMap.get(input.employeeId);
    if (!emp) continue;

    let gross = input.grossOverride ?? 0;
    let hours: number | undefined;
    if (input.grossOverride === undefined && emp.annualSalary) {
      gross = Math.round(emp.annualSalary / paysPerYear(emp.payFrequency));
    } else if (input.grossOverride === undefined && emp.hourlyRate) {
      hours = input.hoursWorked ?? emp.standardHours ?? 0;
      gross = Math.round(hours * emp.hourlyRate);
    }
    const extra = input.extraPay ?? 0;
    const kind = input.extraPayKind ?? "bonus";

    lines.push(
      calculatePayLine(emp, gross, year, {
        earningsNotLiableAcc: input.earningsNotLiableAcc,
        childSupport: input.childSupport,
        hours,
        ...(extra > 0
          ? {
              extraPay: extra,
              extraPayKind: kind,
              annualised: annualisedForExtraPay({
                employeeId: emp.id,
                frequency: emp.payFrequency,
                kind,
                payDate: params.payDate,
                thisPay: gross,
                history: params.history ?? [],
              }),
            }
          : {}),
        payrollDonation: input.payrollDonation,
        ess: input.ess,
        priorGross: input.priorGross,
        priorPaye: input.priorPaye,
      }),
    );
  }

  const sum = (fn: (l: PayLine) => Cents): Cents => lines.reduce((acc, l) => acc + fn(l), 0);

  return {
    id,
    employerIrd: cleanIrdNumber(params.employerIrd),
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    payDate: params.payDate,
    taxYear: year,
    lines,
    totalGross: sum((l) => l.gross),
    totalPaye: sum((l) => l.paye),
    totalStudentLoan: sum((l) => l.studentLoan),
    totalKiwiSaverEmployee: sum((l) => l.kiwiSaverEmployee),
    totalKiwiSaverEmployer: sum((l) => l.kiwiSaverEmployer),
    totalKiwiSaverEmployerNet: sum((l) => l.kiwiSaverEmployerNet ?? l.kiwiSaverEmployer - l.esct),
    totalEsct: sum((l) => l.esct),
    totalChildSupport: sum((l) => l.childSupport),
    totalSlcir: sum((l) => l.slcir ?? 0),
    totalSlbor: sum((l) => l.slbor ?? 0),
    totalDonations: sum((l) => l.payrollDonation ?? 0),
    totalDonationCredits: sum((l) => l.donationCredit ?? 0),
    totalEss: sum((l) => l.ess ?? 0),
    totalPriorGross: sum((l) => l.priorGross ?? 0),
    totalPriorPaye: sum((l) => l.priorPaye ?? 0),
    totalNetPay: sum((l) => l.netPay),
    ...(note !== null ? { notes: [note] } : {}),
  };
}

// --- the payday filing file ----------------------------------------------------

/** Who IR should contact about the return: required on every EI. */
export interface PayrollContact {
  name: string;
  phone: string;
  email: string;
}

/** Identifies this software on the return, as the specification asks. */
export const PAYROLL_PACKAGE = "NZOSA_Payroll_v1.0";

const CYCLE: Readonly<Record<PayFrequency, string>> = {
  weekly: "WK",
  fortnightly: "FT",
  "four-weekly": "4W",
  monthly: "MT",
};

const irdDate = (iso: IsoDate): string => iso.replace(/-/g, "");
const irdNumber9 = (raw: string): string => {
  const digits = cleanIrdNumber(raw);
  return digits === "" ? "000000000" : digits.padStart(9, "0");
};
/** Text fields may not hold commas; the file is plain CSV with no quoting. */
const plain = (text: string, max: number): string =>
  text.replace(/[,\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** What would stop the file being accepted, said before it is made. */
export function paydayFilingProblems(run: PayRun, contact: PayrollContact): string[] {
  const problems: string[] = [];
  if (!isValidIrdNumber(run.employerIrd)) problems.push("the employer IRD number is not a valid one");
  if (contact.name.trim() === "") problems.push("a payroll contact name is needed");
  if (contact.phone.trim() === "") problems.push("a payroll contact phone number is needed");
  if (!/^[A-Za-z0-9._-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(contact.email.trim()) || contact.email.includes("..")) {
    problems.push("a payroll contact email is needed");
  }
  for (const line of run.lines) {
    if (line.irdNumber !== "" && !isValidIrdNumber(line.irdNumber)) {
      problems.push(`${line.employeeName}'s IRD number is not a valid one`);
    }
  }
  return problems;
}

/**
 * The Employment Information return for a payday, in the HEI2/DEI layout.
 *
 * One header, then one line per employee. Money is in cents with no point,
 * dates are CCYYMMDD, and the header carries the totals of the lines. Family
 * tax credits are Work and Income's alone and always go as zero.
 */
export function generatePaydayFilingCsv(
  run: PayRun,
  contact: PayrollContact,
  options: { finalReturn?: boolean } = {},
): string {
  const n = (cents: Cents): string => String(Math.round(cents));
  const inPeriod = (date: IsoDate | undefined): string =>
    date !== undefined && date >= run.periodStart && date <= run.periodEnd ? irdDate(date) : "";

  const net = (l: PayLine): Cents => l.kiwiSaverEmployerNet ?? l.kiwiSaverEmployer - l.esct;
  const sum = (fn: (l: PayLine) => Cents): Cents => run.lines.reduce((acc, l) => acc + fn(l), 0);
  const totals = {
    gross: sum((l) => l.gross),
    notLiable: sum((l) => l.earningsNotLiableAcc),
    paye: sum((l) => l.paye),
    childSupport: sum((l) => l.childSupport),
    studentLoan: sum((l) => l.studentLoan),
    kiwiSaver: sum((l) => l.kiwiSaverEmployee),
    employerNet: sum(net),
    esct: sum((l) => l.esct),
    slcir: sum((l) => l.slcir ?? 0),
    slbor: sum((l) => l.slbor ?? 0),
    credits: sum((l) => l.donationCredit ?? 0),
    ess: sum((l) => l.ess ?? 0),
    priorGross: sum((l) => l.priorGross ?? 0),
    priorPaye: sum((l) => l.priorPaye ?? 0),
  };
  // PAYE less payroll giving credits, and every other amount paid to IR.
  const deducted =
    totals.paye - totals.credits + totals.childSupport + totals.studentLoan + totals.kiwiSaver +
    totals.employerNet + totals.esct + totals.slcir + totals.slbor;

  const rows: string[] = [];
  rows.push(
    [
      "HEI2",
      irdNumber9(run.employerIrd),
      irdDate(run.payDate),
      options.finalReturn === true ? "Y" : "N",
      run.lines.length === 0 ? "Y" : "N",
      "",
      plain(contact.name, 20),
      plain(contact.phone, 12).replace(/\s+/g, ""),
      plain(contact.email, 60),
      String(run.lines.length),
      n(totals.gross),
      n(totals.priorGross),
      n(totals.notLiable),
      n(totals.paye),
      n(totals.priorPaye),
      n(totals.childSupport),
      n(totals.studentLoan),
      n(totals.slcir),
      n(totals.slbor),
      n(totals.kiwiSaver),
      n(totals.employerNet),
      n(totals.esct),
      n(deducted),
      n(totals.credits),
      "0",
      n(totals.ess),
      PAYROLL_PACKAGE,
      "0001",
    ].join(","),
  );

  for (const line of run.lines) {
    rows.push(
      [
        "DEI",
        irdNumber9(line.irdNumber),
        plain(line.employeeName, 255),
        line.taxCode,
        inPeriod(line.startDate),
        inPeriod(line.finishDate),
        irdDate(run.periodStart),
        irdDate(run.periodEnd),
        CYCLE[line.frequency ?? "fortnightly"],
        String(Math.round((line.hours ?? 0) * 100)),
        n(line.gross),
        n(line.priorGross ?? 0),
        n(line.earningsNotLiableAcc),
        line.lumpSumLowRate === true ? "1" : "0",
        n(line.paye),
        n(line.priorPaye ?? 0),
        n(line.childSupport),
        line.childSupportCode ?? "",
        n(line.studentLoan),
        n(line.slcir ?? 0),
        n(line.slbor ?? 0),
        n(line.kiwiSaverEmployee),
        n(net(line)),
        n(line.esct),
        n(line.donationCredit ?? 0),
        "0",
        n(line.ess ?? 0),
      ].join(","),
    );
  }

  return rows.join("\r\n") + "\r\n";
}

// --- the journal ----------------------------------------------------------------

export interface PayrollAccount {
  code: string;
  name: string;
}

/** Where a pay run posts. The two optional ones fall back to wages and PAYE payable. */
export interface PayrollAccounts {
  wages: PayrollAccount;
  kiwiSaverExpense?: PayrollAccount | undefined;
  wagesPayable: PayrollAccount;
  payePayable: PayrollAccount;
  kiwiSaverPayable?: PayrollAccount | undefined;
}

/**
 * The journal a pay run posts, on the payday.
 *
 *   Dr Wages and salaries                 gross pay
 *   Dr KiwiSaver employer contributions   the employer's contribution, before ESCT
 *   Cr PAYE payable                       PAYE, student loan, child support and ESCT
 *   Cr KiwiSaver payable                  employee deductions and the employer's net contribution
 *   Cr Wages payable                      net pay
 *
 * Everything but net pay goes to Inland Revenue with the employer deductions,
 * KiwiSaver included. The bank payment of net pay is then coded to wages
 * payable and the payment to IR to the payables, which clears them -- coding
 * either to wages would count the wages twice. No GST: wages are not a supply.
 */
export function payrollJournal(run: PayRun, accounts: PayrollAccounts): PostedJournal | null {
  if (run.lines.length === 0) return null;
  const ksExpense = accounts.kiwiSaverExpense ?? accounts.wages;
  const ksPayable = accounts.kiwiSaverPayable ?? accounts.payePayable;
  const employerNet = run.totalKiwiSaverEmployerNet ?? run.totalKiwiSaverEmployer - run.totalEsct;
  const toIr =
    run.totalPaye - (run.totalDonationCredits ?? 0) + (run.totalPriorPaye ?? 0) + run.totalStudentLoan +
    (run.totalSlcir ?? 0) + (run.totalSlbor ?? 0) + run.totalChildSupport + run.totalEsct;
  const kiwiSaver = run.totalKiwiSaverEmployee + employerNet;

  const raw: [PayrollAccount, Cents, string][] = [
    [accounts.wages, run.totalGross + (run.totalPriorGross ?? 0), "Gross pay"],
    [ksExpense, run.totalKiwiSaverEmployer, "KiwiSaver employer contributions"],
    [accounts.payePayable, -toIr, "PAYE, student loan, child support and ESCT"],
    [ksPayable, -kiwiSaver, "KiwiSaver deductions and employer contributions"],
    // Payroll donations are passed on to the charity, so they sit with net pay.
    [accounts.wagesPayable, -(run.totalNetPay + (run.totalDonations ?? 0)), "Net pay and payroll donations"],
  ];
  // One line per account, so a fallback to the same account nets rather than
  // showing a debit and a credit to one place.
  const byCode = new Map<string, PostedLine>();
  for (const [account, amount, description] of raw) {
    if (amount === 0) continue;
    const held = byCode.get(account.code);
    if (held !== undefined) {
      held.amount += amount;
      held.description = `${held.description}; ${description}`;
    } else {
      byCode.set(account.code, {
        accountCode: account.code,
        accountName: account.name,
        amount,
        taxType: "NONE",
        description,
      });
    }
  }
  return {
    transactionId: `payroll:${run.id}`,
    date: run.payDate,
    narration: `Pay run, ${run.periodStart} to ${run.periodEnd}`,
    lines: [...byCode.values()].filter((l) => l.amount !== 0),
    source: "payroll",
    taxBasis: "both",
  };
}
