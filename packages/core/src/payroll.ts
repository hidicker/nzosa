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
   * the rate they elected on their IR330C, or the one on the certificate.
   */
  taxRate?: number | undefined;
  bankAccount: string;
  startDate?: IsoDate | undefined;
  finishDate?: IsoDate | undefined;
}

export interface PayLineInput {
  employeeId: string;
  hoursWorked?: number | undefined;
  grossOverride?: Cents | undefined;
  earningsNotLiableAcc?: Cents | undefined;
  childSupport?: Cents | undefined;
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
};
const FIRST_YEAR = 2026;
const LAST_YEAR = 2027;

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

/**
 * Work out one employee's pay.
 *
 * `year` is the tax year, named by the 31 March it ends on; a pay run takes
 * it from the payday.
 */
export function calculatePayLine(
  employee: Employee,
  gross: Cents,
  year = LAST_YEAR,
  options?: {
    earningsNotLiableAcc?: Cents | undefined;
    childSupport?: Cents | undefined;
    hours?: number | undefined;
  },
): PayLine {
  const { rates } = ratesFor(year);
  const frequency = employee.payFrequency;
  // Nobody is taxed at M without having said so: no IRD number is the
  // no-notification rate, whatever code was typed in.
  const code: TaxCode = employee.irdNumber.trim() === "" && employee.taxCode !== "NSW" ? "ND" : employee.taxCode;
  const childSupport = options?.childSupport ?? 0;
  const payDollars = wholeDollars(gross);

  let paye = 0;
  let earningsNotLiableAcc = options?.earningsNotLiableAcc ?? 0;
  if (PRIMARY.has(code)) {
    paye = primaryPaye(gross, frequency, code, rates);
  } else if (code === "WT") {
    // Schedular payments: the elected (or standard) rate on the payment, no
    // earners' levy, and all of it reported as not liable for the levy.
    paye = truncCents(gross * (employee.taxRate ?? 0.45));
    earningsNotLiableAcc = gross;
  } else if (code === "STC") {
    paye = truncCents(payDollars * ((employee.taxRate ?? 0) + rates.levy));
  } else {
    paye = truncCents(payDollars * ((FLAT_RATES[code] ?? 0.45) + rates.levy));
  }

  let studentLoan = 0;
  if (code === "M SL" || code === "ME SL") {
    const over = payDollars - SL_THRESHOLD[frequency];
    studentLoan = over > 0 ? truncCents(over * 0.12) : 0;
  } else if (SECONDARY_SL.has(code)) {
    studentLoan = truncCents(payDollars * 0.12);
  }

  // Not for a non-resident seasonal worker, who cannot join, or a schedular
  // payee, who is not an employee.
  const kiwiSaverApplies = code !== "NSW" && code !== "WT";
  const kiwiSaverEmployee = kiwiSaverApplies ? truncCents(gross * employee.kiwiSaverRate) : 0;
  const kiwiSaverEmployer = kiwiSaverApplies ? truncCents(gross * employee.kiwiSaverEmployerRate) : 0;
  const esctRate =
    employee.esctRate > 0
      ? employee.esctRate
      : esctRateFor((gross + kiwiSaverEmployer) * paysPerYear(frequency));
  // ESCT is worked on the contribution in whole dollars (section 5.20.6).
  const esct = kiwiSaverEmployer > 0 ? truncCents(wholeDollars(kiwiSaverEmployer) * esctRate) : 0;

  return {
    employeeId: employee.id,
    employeeName: employee.name,
    irdNumber: cleanIrdNumber(employee.irdNumber),
    taxCode: code,
    frequency,
    ...(options?.hours !== undefined ? { hours: options.hours } : {}),
    gross,
    earningsNotLiableAcc,
    paye,
    studentLoan,
    kiwiSaverEmployee,
    kiwiSaverEmployer,
    kiwiSaverEmployerNet: kiwiSaverEmployer - esct,
    esct,
    childSupport,
    netPay: gross - paye - studentLoan - kiwiSaverEmployee - childSupport,
    startDate: employee.startDate,
    finishDate: employee.finishDate,
  };
}

/** Assemble a pay run: each employee's line, at the rates for the payday's tax year. */
export function buildPayRun(params: {
  id?: string | undefined;
  employerIrd: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  payDate: IsoDate;
  employees: Employee[];
  inputs: PayLineInput[];
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

    lines.push(
      calculatePayLine(emp, gross, year, {
        earningsNotLiableAcc: input.earningsNotLiableAcc,
        childSupport: input.childSupport,
        hours,
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
 * dates are CCYYMMDD, and the header carries the totals of the lines. Prior
 * period adjustments, SLCIR/SLBOR, payroll giving, family tax credits and
 * employee share schemes are not handled here and go as zero.
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
  };
  const deducted =
    totals.paye + totals.childSupport + totals.studentLoan + totals.kiwiSaver + totals.employerNet + totals.esct;

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
      "0",
      n(totals.notLiable),
      n(totals.paye),
      "0",
      n(totals.childSupport),
      n(totals.studentLoan),
      "0",
      "0",
      n(totals.kiwiSaver),
      n(totals.employerNet),
      n(totals.esct),
      n(deducted),
      "0",
      "0",
      "0",
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
        "0",
        n(line.earningsNotLiableAcc),
        "0",
        n(line.paye),
        "0",
        n(line.childSupport),
        "",
        n(line.studentLoan),
        "0",
        "0",
        n(line.kiwiSaverEmployee),
        n(net(line)),
        n(line.esct),
        "0",
        "0",
        "0",
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
  const toIr = run.totalPaye + run.totalStudentLoan + run.totalChildSupport + run.totalEsct;
  const kiwiSaver = run.totalKiwiSaverEmployee + employerNet;

  const raw: [PayrollAccount, Cents, string][] = [
    [accounts.wages, run.totalGross, "Gross pay"],
    [ksExpense, run.totalKiwiSaverEmployer, "KiwiSaver employer contributions"],
    [accounts.payePayable, -toIr, "PAYE, student loan, child support and ESCT"],
    [ksPayable, -kiwiSaver, "KiwiSaver deductions and employer contributions"],
    [accounts.wagesPayable, -run.totalNetPay, "Net pay"],
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
